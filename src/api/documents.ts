export interface DocumentMeta {
  id: string;
  name: string | null;
  language: string | null;
  created_at: number;
  updated_at: number;
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const response = await fetch("/api/documents");
  if (!response.ok) {
    throw new Error("Failed to fetch documents");
  }
  return response.json();
}

export async function createDocument(name?: string): Promise<DocumentMeta> {
  const response = await fetch("/api/documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || null }),
  });
  if (!response.ok) {
    throw new Error("Failed to create document");
  }
  return response.json();
}

export async function getDocument(id: string): Promise<DocumentMeta | null> {
  const response = await fetch(`/api/documents/${id}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Failed to fetch document");
  }
  return response.json();
}

export async function renameDocument(id: string, name: string): Promise<DocumentMeta> {
  const response = await fetch(`/api/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error("Failed to rename document");
  }
  return response.json();
}

export async function deleteDocument(id: string): Promise<void> {
  const response = await fetch(`/api/documents/${id}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Failed to delete document");
  }
}
