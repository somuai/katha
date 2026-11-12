import { useEffect, useState, useRef } from "react";
async function request(path: string, options: RequestInit = {}) {
  const r = await fetch("/api/connections" + path, {
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Connection failed");
  return data;
}
export function Connections({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [label, setLabel] = useState(""),
    [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [resources, setResources] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [cursor, setCursor] = useState<string | undefined>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const panel = useRef<HTMLElement>(null);
  const refresh = async () => setItems((await request("")).connections);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const previous = document.activeElement as HTMLElement;
    return () => previous?.focus();
  }, []);
  async function browse(id: string, next?: string) {
    setBusy(true);
    setError("");
    setSelected(id);
    try {
      const data = await request(
        "/" +
          id +
          "/resources" +
          (next ? "?cursor=" + encodeURIComponent(next) : ""),
      );
      setResources(data.resources || []);
      setCursor(data.nextCursor);
    } catch (e: any) {
      setResources([]);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inspector-backdrop">
      <section
        className="inspector connections"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connections-title"
        ref={panel}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const elements = Array.from(
              panel.current!.querySelectorAll<HTMLElement>("button,input,a"),
            ).filter((x) => !(x as HTMLButtonElement).disabled);
            if (e.shiftKey && document.activeElement === elements[0]) {
              e.preventDefault();
              elements.at(-1)?.focus();
            } else if (
              !e.shiftKey &&
              document.activeElement === elements.at(-1)
            ) {
              e.preventDefault();
              elements[0]?.focus();
            }
          }
        }}
      >
        <button
          className="icon inspector-close"
          onClick={onClose}
          aria-label="Close connections"
          autoFocus
        >
          ×
        </button>
        <h2 id="connections-title">Connections</h2>
        <p>Add a remote MCP server to import its files into Katha’s memory.</p>
        <p className="connection-note">
          Read-only text resources are supported. Canva and CRM servers that
          require OAuth or expose files through tools need a provider adapter;
          they are not automatically connected to your Codex account.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const added = await request("", {
                method: "POST",
                body: JSON.stringify({ label, url, token }),
              });
              setLabel("");
              setUrl("");
              setToken("");
              await refresh();
              await browse(added.id);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Connection name
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <label>
            HTTPS MCP server URL
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-server.example/mcp"
              required
            />
          </label>
          <label>
            Bearer token, if required
            <input
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <small>
            Credentials are stored privately by this local Katha instance, never
            in chat or browser storage.
          </small>
          <button type="submit" disabled={busy}>
            Add server
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <h3>Your servers</h3>
        {items.length === 0 && <p>No servers added.</p>}
        {items.map((item) => (
          <article className="connection-item" key={item.id}>
            <strong>{item.label}</strong>
            <small>{item.url}</small>
            <button disabled={busy} onClick={() => browse(item.id)}>
              Browse resources
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                await request("/" + item.id, { method: "DELETE" });
                if (selected === item.id) {
                  setResources([]);
                  setSelected("");
                }
                await refresh();
              }}
            >
              Remove
            </button>
          </article>
        ))}
        {selected && (
          <section>
            <h3>Available resources</h3>
            {resources.map((resource) => (
              <article key={resource.uri}>
                <span>{resource.name || resource.uri}</span>
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await request("/" + selected + "/import", {
                        method: "POST",
                        body: JSON.stringify({ uri: resource.uri }),
                      });
                      setMessage(
                        "Imported into your files. Use @ to attach it to a message.",
                      );
                      onImported();
                    } catch (e: any) {
                      setError(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Import
                </button>
              </article>
            ))}
            {cursor && (
              <button disabled={busy} onClick={() => browse(selected, cursor)}>
                Next page
              </button>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
