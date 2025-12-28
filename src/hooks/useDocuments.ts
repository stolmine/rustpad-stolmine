import { useCallback, useEffect, useState } from "react";
import * as api from "../api/documents";
import type { DocumentMeta } from "../api/documents";

export function useDocuments() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const docs = await api.listDocuments();
      setDocuments(docs);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(async (name?: string) => {
    const doc = await api.createDocument(name);
    setDocuments((prev) => [doc, ...prev]);
    return doc;
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const doc = await api.renameDocument(id, name);
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? doc : d))
    );
    return doc;
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteDocument(id);
    setDocuments((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const deleteAll = useCallback(async () => {
    const result = await api.deleteAllDocuments();
    setDocuments([]);
    return result;
  }, []);

  return { documents, loading, error, refresh, create, rename, remove, deleteAll };
}
