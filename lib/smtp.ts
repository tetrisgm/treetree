import { connect } from "cloudflare:sockets";
import { archiveDomain } from "./archive-config";

/** A small SMTP client that runs inside a Worker.
 *
 * Nodemailer cannot: it wants Node's net/tls. Workers expose raw TCP through
 * cloudflare:sockets instead, so this speaks the protocol directly - implicit
 * TLS on 465 (smtps://) or STARTTLS on 587 (smtp://), AUTH LOGIN, one message,
 * QUIT. No dependency, and nothing here logs the credentials it is given. */

export type MailMessage = { to: string | string[]; from: string; subject: string; text: string; html?: string; replyTo?: string };

type Parsed = { host: string; port: number; user: string; pass: string; implicitTls: boolean };

export function parseSmtpUrl(value: string): Parsed {
  const url = new URL(value);
  const implicitTls = url.protocol === "smtps:";
  return {
    host: url.hostname,
    port: Number(url.port) || (implicitTls ? 465 : 587),
    user: decodeURIComponent(url.username),
    pass: decodeURIComponent(url.password),
    implicitTls,
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Conversation {
  private buffer = "";
  constructor(private reader: ReadableStreamDefaultReader<Uint8Array>, private writer: WritableStreamDefaultWriter<Uint8Array>) {}

  /** SMTP replies can span lines ("250-PIPELINING" … "250 HELP"); the last one
   * is the code followed by a space. */
  async read(expected: number): Promise<string> {
    while (true) {
      const complete = /^(\d{3}) [^\n]*\n?$/m.test(this.buffer) && /(^|\n)(\d{3}) [^\n]*\n$/.test(this.buffer);
      if (complete) break;
      const { value, done } = await this.reader.read();
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });
    }
    const response = this.buffer;
    this.buffer = "";
    const code = Number(/(?:^|\n)(\d{3}) /.exec(response)?.[1] ?? response.slice(0, 3));
    if (code !== expected) throw new Error(`SMTP expected ${expected} but got: ${response.trim().slice(0, 200)}`);
    return response;
  }

  async send(line: string, expected: number): Promise<string> {
    await this.writer.write(encoder.encode(`${line}\r\n`));
    return this.read(expected);
  }
}

const base64 = (value: string) => btoa(String.fromCharCode(...encoder.encode(value)));
/** A line of "." alone ends the message, so any such line in the body is
 * escaped to "..". */
const dotStuff = (body: string) => body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");

function buildMessage(message: MailMessage, recipients: string[]): string {
  const boundary = `b${crypto.randomUUID().replace(/-/g, "")}`;
  const headers = [
    `From: ${message.from}`,
    `To: ${recipients.join(", ")}`,
    message.replyTo ? `Reply-To: ${message.replyTo}` : "",
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${archiveDomain()}>`,
    "MIME-Version: 1.0",
  ].filter(Boolean);
  if (!message.html) {
    return [...headers, "Content-Type: text/plain; charset=utf-8", "", dotStuff(message.text)].join("\r\n");
  }
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    dotStuff(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "",
    dotStuff(message.html),
    `--${boundary}--`,
  ].join("\r\n");
}

export async function sendMail(smtpUrl: string, message: MailMessage): Promise<void> {
  const config = parseSmtpUrl(smtpUrl);
  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).filter(Boolean);
  if (!recipients.length) throw new Error("no_recipients");
  const address = (value: string) => /<([^>]+)>/.exec(value)?.[1] ?? value.trim();

  const socket = connect({ hostname: config.host, port: config.port },
    { secureTransport: config.implicitTls ? "on" : "starttls", allowHalfOpen: false });
  let active = socket;
  let writer = active.writable.getWriter();
  let reader = active.readable.getReader();
  let talk = new Conversation(reader, writer);
  try {
    await talk.read(220);
    await talk.send(`EHLO ${archiveDomain()}`, 250);
    if (!config.implicitTls) {
      await talk.send("STARTTLS", 220);
      reader.releaseLock(); writer.releaseLock();
      active = socket.startTls();
      writer = active.writable.getWriter();
      reader = active.readable.getReader();
      talk = new Conversation(reader, writer);
      await talk.send(`EHLO ${archiveDomain()}`, 250);
    }
    await talk.send("AUTH LOGIN", 334);
    await talk.send(base64(config.user), 334);
    await talk.send(base64(config.pass), 235);
    await talk.send(`MAIL FROM:<${address(message.from)}>`, 250);
    for (const recipient of recipients) await talk.send(`RCPT TO:<${address(recipient)}>`, 250);
    await talk.send("DATA", 354);
    await writer.write(encoder.encode(`${buildMessage(message, recipients)}\r\n.\r\n`));
    await talk.read(250);
    await talk.send("QUIT", 221);
  } finally {
    try { await writer.close(); } catch { /* the server may have closed first */ }
    try { await active.close(); } catch { /* already closed */ }
  }
}
