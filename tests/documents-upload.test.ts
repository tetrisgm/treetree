import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_MULTIPART_BYTES, MAX_UPLOAD_FILES } from "../lib/upload-policy";

const store = vi.hoisted(() => ({
  listAttachments: vi.fn(),
  queueDocument: vi.fn(),
  saveAttachment: vi.fn(),
}));
const authz = vi.hoisted(() => ({ requireEditor: vi.fn() }));

vi.mock("../db/store", () => store);
vi.mock("../app/authz", () => authz);

import { POST } from "../app/api/documents/route";

function uploadRequest(files: File[]) {
  const body = new FormData();
  for (const file of files) body.append("files", file);
  return new Request("https://archive.example/api/documents", { method: "POST", body });
}

beforeEach(() => {
  vi.clearAllMocks();
  authz.requireEditor.mockResolvedValue({ ok: true, user: { email: "editor@example.com" } });
  store.saveAttachment.mockImplementation(async (file: File) => ({
    id: `attachment-${file.name}`,
    filename: file.name,
    contentType: file.type,
    size: file.size,
  }));
  store.queueDocument.mockResolvedValue(undefined);
});

describe("document upload boundary", () => {
  it("rejects an oversized request before multipart parsing", async () => {
    const response = await POST(new Request("https://archive.example/api/documents", {
      method: "POST",
      headers: { "content-length": String(MAX_MULTIPART_BYTES + 1) },
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "files_too_large" });
    expect(store.saveAttachment).not.toHaveBeenCalled();
  });

  it("rejects too many multipart files before storing any", async () => {
    const files = Array.from({ length: MAX_UPLOAD_FILES + 1 }, (_, index) =>
      new File(["x"], `note-${index}.txt`, { type: "text/plain" }));

    const response = await POST(uploadRequest(files));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({ error: "too_many_files" });
    expect(store.saveAttachment).not.toHaveBeenCalled();
  });

  it("stores and queues files in a bounded sequence", async () => {
    const order: string[] = [];
    store.saveAttachment.mockImplementation(async (file: File) => {
      order.push(`save:${file.name}`);
      return { id: `attachment-${file.name}`, filename: file.name, contentType: file.type, size: file.size };
    });
    store.queueDocument.mockImplementation(async (_id: string, filename: string) => {
      order.push(`queue:${filename}`);
    });

    const response = await POST(uploadRequest([
      new File(["a"], "a.txt", { type: "text/plain" }),
      new File(["b"], "b.txt", { type: "text/plain" }),
    ]));

    expect(response.status).toBe(200);
    expect(order).toEqual(["save:a.txt", "queue:a.txt", "save:b.txt", "queue:b.txt"]);
  });
});
