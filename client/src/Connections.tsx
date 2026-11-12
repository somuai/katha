import { useEffect, useState, useRef } from "react";
async function request(path: string, options: RequestInit = {}) {
  const r = await fetch("/api/connections" + path, {
    ...options,
    headers: { "Content-Type": "application/json" },
  });
  const data = await r.json();
  if (!r.ok) {
    const error = new Error(data.error || "Connection failed");
    Object.assign(error, { code: data.code });
    throw error;
  }
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
    [providers, setProviders] = useState<any[]>([]),
    [provider, setProvider] = useState(""),
    [query, setQuery] = useState(""),
    [kinds, setKinds] = useState<string[]>(["contacts"]),
    [recordKind, setRecordKind] = useState("contacts"),
    [authorizedKinds, setAuthorizedKinds] = useState<string[]>([]),
    [providerRows, setProviderRows] = useState<any[]>([]),
    [providerCursor, setProviderCursor] = useState<string | undefined>(),
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
  const refresh = async () => {
    const [custom, named] = await Promise.all([
      request(""),
      request("/providers"),
    ]);
    setItems(custom.connections);
    setProviders(named.providers);
    setAuthorizedKinds(named.hubspotKinds || []);
  };
  async function authorize(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await request("/" + id + "/authorize", {
        method: "POST",
        body: JSON.stringify(id === "hubspot" ? { kinds } : {}),
      });
      if (result.authorizationUrl)
        window.location.assign(result.authorizationUrl);
      else {
        setMessage("Authorized. You can browse this connection.");
        await refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function browseProvider(id: string, next?: string) {
    setProvider(id);
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({
        q: query,
        ...(next ? { cursor: next } : {}),
        ...(id === "hubspot" || id === "hubspot-mcp" || id === "salesforce"
          ? { kind: recordKind }
          : {}),
      });
      const data = await request(
        "/" +
          id +
          (id === "gmail"
            ? "/messages?"
            : id === "hubspot" || id === "hubspot-mcp" || id === "salesforce"
              ? "/records?"
              : "/resources?") +
          params,
      );
      setProviderRows(data.messages || data.resources || []);
      setProviderCursor(data.nextCursor);
    } catch (e: any) {
      setError(e.message);
      setProviderRows([]);
    } finally {
      setBusy(false);
    }
  }
  async function importProvider(id: string) {
    setBusy(true);
    setError("");
    try {
      await request("/" + provider + "/import", {
        method: "POST",
        body: JSON.stringify({ id, kind: recordKind }),
      });
      setMessage(
        "Selected source imported into your files. Katha can now recall it.",
      );
      onImported();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
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
              panel.current!.querySelectorAll<HTMLElement>(
                "button,input,a,select,summary",
              ),
            ).filter(
              (x) =>
                !(x as HTMLButtonElement).disabled &&
                x.getClientRects().length > 0,
            );
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
        <p>
          Choose a service, review its access, then sign in on the provider’s
          consent screen.
        </p>
        <details className="connection-note">
          <summary>Access and privacy</summary>
          <p>
            Only selected imports become Katha sources. They may be sent to your
            configured answer provider when relevant. Disconnect stops future
            access; remove imported files separately to delete retained content.
            This instance is a single local workspace, not a shared multi-user
            service.
          </p>
        </details>
        <div className="provider-catalog">
          {[...providers]
            .sort(
              (a, b) =>
                Number(b.integration === "Official MCP") -
                Number(a.integration === "Official MCP"),
            )
            .map((p) => (
              <article className="provider-card" key={p.id}>
                <span
                  className={"provider-mark provider-mark--" + p.id}
                  aria-hidden="true"
                >
                  {["gmail", "notion", "canva"].includes(p.id) ? (
                    <img src={"/assets/providers/" + p.id + ".ico"} alt="" />
                  ) : p.id === "hubspot" ? (
                    "H"
                  ) : (
                    p.name[0]
                  )}
                </span>
                <div>
                  <h3>{p.name}</h3>
                  {p.integration && (
                    <small>
                      {p.integration} ·{" "}
                      <a
                        href={p.documentation}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Provider documentation
                      </a>
                    </small>
                  )}
                  <p>{p.description}</p>
                  {!p.available &&
                    (p.status === "not_implemented" ? (
                      <small>Not supported yet</small>
                    ) : (
                      <details className="provider-setup">
                        <summary>One-time app setup needed</summary>
                        <small>{p.setup}</small>
                      </details>
                    ))}
                  {p.id === "hubspot" && p.available && !p.connected && (
                    <fieldset>
                      <legend>Request read access to</legend>
                      {["contacts", "companies", "deals"].map((kind) => (
                        <label className="scope-check" key={kind}>
                          <input
                            type="checkbox"
                            checked={kinds.includes(kind)}
                            onChange={(e) =>
                              setKinds(
                                e.target.checked
                                  ? [...kinds, kind]
                                  : kinds.filter((k) => k !== kind),
                              )
                            }
                          />
                          {kind}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {p.available && !p.connected && (
                    <button
                      disabled={busy || (p.id === "hubspot" && !kinds.length)}
                      onClick={() => authorize(p.id)}
                    >
                      Connect {p.name}
                    </button>
                  )}
                  {p.connected && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setProvider(p.id);
                          setProviderRows([]);
                          setQuery("");
                          if (p.id === "hubspot")
                            setRecordKind(authorizedKinds[0] || "contacts");
                        }}
                      >
                        Choose sources
                      </button>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          try {
                            await request("/" + p.id, { method: "DELETE" });
                            setProvider("");
                            setProviderRows([]);
                            await refresh();
                          } catch (e: any) {
                            setError(e.message);
                          }
                        }}
                      >
                        Disconnect {p.name}
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
        </div>
        {provider && (
          <section className="provider-selection">
            <h3>
              {provider === "gmail"
                ? "Choose messages"
                : provider === "hubspot" ||
                    provider === "hubspot-mcp" ||
                    provider === "salesforce"
                  ? "Choose CRM records"
                  : provider === "notion"
                    ? "Choose Notion pages"
                    : "Choose existing designs"}
            </h3>
            {provider === "gmail" && (
              <small>
                Google’s read-only permission covers your mailbox; this is not a
                per-message OAuth permission. Katha reads previews for this
                search and retains only messages you import.
              </small>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                browseProvider(provider);
              }}
            >
              {(provider === "hubspot" ||
                provider === "hubspot-mcp" ||
                provider === "salesforce") && (
                <label>
                  Record type
                  <select
                    value={recordKind}
                    onChange={(e) => {
                      setRecordKind(e.target.value);
                      setProviderRows([]);
                      setProviderCursor(undefined);
                    }}
                  >
                    {(provider === "hubspot-mcp" || provider === "salesforce"
                      ? ["contacts", "companies", "deals"]
                      : authorizedKinds
                    ).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                </label>
              )}
              {provider !== "salesforce" && (
                <label>
                  {provider === "gmail"
                    ? "Search mail (optional)"
                    : provider === "hubspot" ||
                        provider === "hubspot-mcp" ||
                        provider === "salesforce"
                      ? "Search records (optional)"
                      : "Search sources"}
                  <input
                    value={query}
                    maxLength={500}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              <button disabled={busy}>
                {provider === "salesforce" ? "Show recently viewed" : "Search"}{" "}
                {provider === "salesforce"
                  ? ""
                  : provider === "gmail"
                    ? "messages"
                    : provider === "hubspot" ||
                        provider === "hubspot-mcp" ||
                        provider === "salesforce"
                      ? "records"
                      : "sources"}
              </button>
            </form>
            {providerRows.map((row) => (
              <article className="connection-item" key={row.id}>
                <strong>{row.subject || row.title || "Untitled"}</strong>
                <small>{row.from || row.summary}</small>
                <p>{row.snippet}</p>
                <button disabled={busy} onClick={() => importProvider(row.id)}>
                  Import selected{" "}
                  {provider === "gmail"
                    ? "message"
                    : provider === "hubspot" ||
                        provider === "hubspot-mcp" ||
                        provider === "salesforce"
                      ? "record"
                      : "source"}
                </button>
              </article>
            ))}
            {providerCursor && (
              <button
                disabled={busy}
                onClick={() => browseProvider(provider, providerCursor)}
              >
                Next results
              </button>
            )}
          </section>
        )}
        <details className="advanced-connections">
          <summary>Advanced: custom MCP server</summary>
          <p>
            For compatible read-only resource servers. Most visitors should use
            the provider picker above.
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
              Credentials are stored privately by this local Katha instance,
              never in chat or browser storage.
            </small>
            <button type="submit" disabled={busy}>
              Add server
            </button>
          </form>

          <h3>Your servers</h3>
          {items.length === 0 && <p>No servers added.</p>}
          {items.map((item) => (
            <article className="connection-item" key={item.id}>
              <strong>{item.label}</strong>
              <small>{item.url}</small>
              <button disabled={busy} onClick={() => authorize(item.id)}>
                Sign in
              </button>
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
                <button
                  disabled={busy}
                  onClick={() => browse(selected, cursor)}
                >
                  Next page
                </button>
              )}
            </section>
          )}
        </details>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </section>
    </div>
  );
}
