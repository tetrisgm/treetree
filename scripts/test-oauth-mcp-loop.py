#!/usr/bin/env python3
"""End-to-end proof of the hosted MCP OAuth loop (the mcp-kit release gate).

Walks: discovery 401 -> RFC 9728 + 8414 documents -> dynamic registration ->
consent approval (as a member, whose session is minted from
LOOP_SESSION_SECRET - the deployment's AUTH_SESSION_SECRET)
-> PKCE token exchange -> MCP initialize -> tools/list -> a real read.

Usage: python3 scripts/test-oauth-mcp-loop.py [origin]   (default production)
Cleanup: registered clients and tokens are rows in oauth_clients /
agent_tokens named "loop-test"; they are inert and expire, but can be
deleted by client_name if tidiness matters.
"""
import base64, hashlib, json, os, secrets, subprocess, sys, time, hmac
import urllib.request, urllib.parse, urllib.error

ORIGIN = sys.argv[1] if len(sys.argv) > 1 else (os.environ.get("LOOP_ORIGIN") or sys.exit("usage: test-oauth-mcp-loop.py <origin>"))
REDIRECT = "http://localhost:43117/callback"

def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")

def header(headers, name):
    return next((value for key, value in headers.items() if key.lower() == name.lower()), "")

UA = "family-archive-loop-test/1.0"

def fetch(url, method="GET", data=None, headers=None, allow_redirect=True):
    req = urllib.request.Request(url, data=data, method=method, headers={"user-agent": UA, **(headers or {})})
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor() if allow_redirect else NoRedirect())
    try:
        with opener.open(req, timeout=30) as response:
            return response.status, dict(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read()

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def session_cookie() -> str:
    # LOOP_SESSION_SECRET/LOOP_MEMBER_EMAIL point at a local dev Worker
    # (.dev.vars); without them the production browser-suite member is used.
    secret = os.environ.get("LOOP_SESSION_SECRET") or sys.exit("set LOOP_SESSION_SECRET to the deployment's AUTH_SESSION_SECRET")
    email = os.environ.get("LOOP_MEMBER_EMAIL", "browser-suite@example.com")
    payload = b64url(json.dumps({"subject": "loop-test", "email": email,
                                 "displayName": "Loop test", "exp": int(time.time()) + 3600}).encode())
    signature = b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"archive_session={payload}.{signature}"

def step(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  ' + detail if detail else ''}")
    if not ok:
        sys.exit(1)

# 1. tokenless MCP call: 401 with resource_metadata pointer
status, headers, _ = fetch(f"{ORIGIN}/api/mcp", method="POST", data=b"{}", headers={"content-type": "application/json"})
step("tokenless 401", status == 401 and "oauth-protected-resource" in header(headers, "www-authenticate"))

# 2. discovery documents (both RFC 9728 forms + RFC 8414 + mcp.json)
for path in ("/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp",
             "/.well-known/oauth-authorization-server", "/.well-known/mcp.json"):
    status, headers, body = fetch(ORIGIN + path)
    document = json.loads(body)
    step(f"discovery {path}", status == 200 and header(headers, "access-control-allow-origin") == "*")
meta = json.loads(fetch(f"{ORIGIN}/.well-known/oauth-authorization-server")[2])

# 3. dynamic client registration
status, _, body = fetch(meta["registration_endpoint"], method="POST",
                        data=json.dumps({"client_name": "loop-test", "redirect_uris": [REDIRECT]}).encode(),
                        headers={"content-type": "application/json"})
registration = json.loads(body)
step("dynamic registration", status == 201 and bool(registration.get("client_id")))
client_id = registration["client_id"]

# 4. consent approval as a signed-in member (form POST, no browser)
verifier = b64url(secrets.token_bytes(48))[:64]
challenge = b64url(hashlib.sha256(verifier.encode()).digest())
form = urllib.parse.urlencode({"client_id": client_id, "redirect_uri": REDIRECT,
                               "code_challenge": challenge, "scope": "read", "state": "loop-state",
                               "decision": "approve"}).encode()
request = urllib.request.Request(f"{ORIGIN}/oauth/authorize/approve", data=form, method="POST",
                                 headers={"content-type": "application/x-www-form-urlencoded",
                                          "origin": ORIGIN, "cookie": session_cookie(), "user-agent": UA})
opener = urllib.request.build_opener(NoRedirect())
try:
    response = opener.open(request, timeout=30)
    status, location = response.status, response.headers.get("Location", "")
except urllib.error.HTTPError as error:
    status, location = error.code, error.headers.get("Location", "")
query = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)
step("consent approval", status == 302 and "code" in query and query.get("state") == ["loop-state"],
     f"status={status}" if status != 302 else "")
code = query["code"][0]

# 5. PKCE token exchange
status, _, body = fetch(meta["token_endpoint"], method="POST",
                        data=urllib.parse.urlencode({"grant_type": "authorization_code", "code": code,
                                                     "client_id": client_id, "redirect_uri": REDIRECT,
                                                     "code_verifier": verifier}).encode(),
                        headers={"content-type": "application/x-www-form-urlencoded"})
token = json.loads(body)
step("token exchange", status == 200 and token.get("token_type") == "Bearer" and token.get("refresh_token", "").startswith("drt_") and token.get("expires_in") == 3600)
auth = {"authorization": f"Bearer {token['access_token']}", "content-type": "application/json"}

# 5b. a replayed code must be rejected
status, _, _ = fetch(meta["token_endpoint"], method="POST",
                     data=urllib.parse.urlencode({"grant_type": "authorization_code", "code": code,
                                                  "client_id": client_id, "redirect_uri": REDIRECT,
                                                  "code_verifier": verifier}).encode(),
                     headers={"content-type": "application/x-www-form-urlencoded"})
step("code replay rejected", status == 400)

def rpc(method, params=None, id=1):
    message = {"jsonrpc": "2.0", "id": id, "method": method}
    if params is not None:
        message["params"] = params
    status, _, body = fetch(f"{ORIGIN}/api/mcp", method="POST", data=json.dumps(message).encode(), headers=auth)
    return status, json.loads(body)

# 6. MCP initialize + tools/list + a real read
status, initialized = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "loop-test", "version": "0"}})
step("mcp initialize", status == 200 and "serverInfo" in initialized.get("result", {}))
status, tools = rpc("tools/list")
names = sorted(tool["name"] for tool in tools["result"]["tools"])
step("tool registry", names == ["family_in_year", "family_origins", "find_person", "how_am_i_related", "life_of",
                                "list_stories", "namesakes", "person_record", "relationship_path", "story",
                                "tree_summary", "upcoming_family_dates"], str(names))
status, summary = rpc("tools/call", {"name": "tree_summary", "arguments": {}})
text = summary["result"]["content"][0]["text"]
step("tree_summary read", status == 200 and "people" in text, text.splitlines()[0][:90])
status, found = rpc("tools/call", {"name": "find_person", "arguments": {"query": "zzz-no-such-person"}})
step("graceful empty find", status == 200 and "No person matching" in found["result"]["content"][0]["text"])

def approve(scope):
    v = b64url(secrets.token_bytes(48))[:64]
    challenge = hashlib.sha256(v.encode()).digest()
    form = urllib.parse.urlencode({"client_id": client_id, "redirect_uri": REDIRECT,
                                   "code_challenge": b64url(challenge), "scope": scope,
                                   "decision": "approve"}).encode()
    request = urllib.request.Request(f"{ORIGIN}/oauth/authorize/approve", data=form, method="POST",
                                     headers={"content-type": "application/x-www-form-urlencoded",
                                              "origin": ORIGIN, "cookie": session_cookie(), "user-agent": UA})
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
        location = response.headers.get("Location", "")
    except urllib.error.HTTPError as error:
        location = error.headers.get("Location", "")
    approved = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)["code"][0]
    _, _, body = fetch(meta["token_endpoint"], method="POST",
                       data=urllib.parse.urlencode({"grant_type": "authorization_code", "code": approved,
                                                    "client_id": client_id, "redirect_uri": REDIRECT,
                                                    "code_verifier": v}).encode(),
                       headers={"content-type": "application/x-www-form-urlencoded"})
    return json.loads(body)

# 6b. refresh rotation: the old refresh token buys a new pair, once
def refresh(rt):
    return fetch(meta["token_endpoint"], method="POST",
                 data=urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": rt,
                                              "client_id": client_id}).encode(),
                 headers={"content-type": "application/x-www-form-urlencoded"})
status, _, body = refresh(token["refresh_token"])
rotated = json.loads(body)
step("refresh rotation", status == 200 and rotated.get("refresh_token", "").startswith("drt_") and rotated["refresh_token"] != token["refresh_token"])
auth = {"authorization": f"Bearer {rotated['access_token']}", "content-type": "application/json"}
status, _ = rpc("ping")
step("rotated access token works", status == 200)
# 6c. replaying the consumed refresh token revokes the whole family
status, _, _ = refresh(token["refresh_token"])
step("refresh replay rejected", status == 400)
status, _ = rpc("ping")
step("replay revoked the family", status == 401)
# a fresh read approval carries the remaining read-scope checks
auth = {"authorization": f"Bearer {approve('read')['access_token']}", "content-type": "application/json"}

# 7. a read-scope token must not be able to file proposals
status, rejected = rpc("tools/call", {"name": "propose_person", "arguments": {"display_name": "Loop Probe", "source_note": "loop test"}})
step("read-scope write rejection", status == 200 and rejected["result"]["isError"] and "reading only" in rejected["result"]["content"][0]["text"])

# 8. approve again with the propose scope and file a real proposal
propose_token = approve("propose")
step("propose-scope token", propose_token.get("scope") == "propose")
auth = {"authorization": f"Bearer {propose_token['access_token']}", "content-type": "application/json"}
status, tools = rpc("tools/list")
names = [tool["name"] for tool in tools["result"]["tools"]]
step("propose tools listed", "propose_person" in names and "list_my_proposals" in names)
unique = f"Loop Probe {secrets.token_hex(3)}"
status, filed = rpc("tools/call", {"name": "propose_person", "arguments": {"display_name": unique, "birth_date": "1990", "source_note": "end-to-end loop test"}})
step("proposal filed", status == 200 and not filed["result"].get("isError") and "Filed for family review" in filed["result"]["content"][0]["text"])
status, mine = rpc("tools/call", {"name": "list_my_proposals", "arguments": {}})
step("proposal listed pending", status == 200 and "[pending]" in mine["result"]["content"][0]["text"] and unique in mine["result"]["content"][0]["text"])

# 9. editor review: apply the proposal through /api/proposals. In production
# the loop member is a viewer and gets 403, which is itself the right answer.
proposal_id = filed["result"]["content"][0]["text"].split("proposal ")[1].split(")")[0]
status, _, body = fetch(f"{ORIGIN}/api/proposals", method="POST",
                        data=json.dumps({"proposalId": proposal_id, "verdict": "apply"}).encode(),
                        headers={"content-type": "application/json", "cookie": session_cookie(), "origin": ORIGIN})
if status == 403 or status == 401:
    step("editor apply gated for viewers", True, f"status={status}")
else:
    step("editor apply", status == 200 and json.loads(body).get("status") == "applied", body[:120].decode(errors="replace"))
    status, found = rpc("tools/call", {"name": "find_person", "arguments": {"query": unique}})
    step("applied proposal reached the tree", unique in found["result"]["content"][0]["text"])
    status, mine = rpc("tools/call", {"name": "list_my_proposals", "arguments": {}})
    step("proposal marked applied", "[applied]" in mine["result"]["content"][0]["text"])

# 10. the member disconnects the assistant from Settings; its token dies now
status, _, body = fetch(f"{ORIGIN}/api/agents", headers={"cookie": session_cookie()})
connections = json.loads(body).get("connections", []) if status == 200 else []
target = next((c for c in connections if c["scope"] == "propose"), None)
if target:
    status, _, body = fetch(f"{ORIGIN}/api/agents", method="POST",
                            data=json.dumps({"tokenId": target["id"]}).encode(),
                            headers={"content-type": "application/json", "cookie": session_cookie()})
    step("connection revoked from settings", status == 200)
    status, _ = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "loop-test", "version": "0"}})
    step("revoked token rejected", status == 401)
else:
    step("connection listed for revocation", False, f"status={status} connections={len(connections)}")

print("\nAll steps passed.")
