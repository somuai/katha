type Source = {
  id?: string;
  kind?: string;
  url?: string;
  metadata?: { connectorId?: string; connectorLabel?: string; url?: string };
};
/** This describes retained evidence actually delivered by the turn, never guessed connections. */
export function Thinking({ sources }: { sources: Source[] }) {
  const labels = new Map<
    string,
    { name: string; icon?: string; glyph: string }
  >();
  for (const source of sources) {
    const connector = source.metadata?.connectorId;
    const sourceUrl = source.url || source.metadata?.url;
    if (connector === "gmail")
      labels.set("gmail", {
        name: "Gmail",
        icon: "/assets/providers/gmail.ico",
        glyph: "M",
      });
    else if (connector === "notion" || connector === "canva")
      labels.set(connector, {
        name: connector === "notion" ? "Notion" : "Canva",
        icon: "/assets/providers/" + connector + ".ico",
        glyph: connector[0],
      });
    else if (connector === "hubspot")
      labels.set("hubspot", { name: "HubSpot", glyph: "H" });
    else if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      try {
        const host = new URL(sourceUrl).hostname.replace(/^www\./, "");
        labels.set(host, { name: host, glyph: host.charAt(0).toUpperCase() });
      } catch {
        /* Invalid source URL is never a destination. */
      }
    } else if (source.kind === "attachment")
      labels.set(connector || "files", {
        name: source.metadata?.connectorLabel || "Your files",
        glyph: "▤",
      });
    else if (source.kind === "message")
      labels.set("history", { name: "Saved conversations", glyph: "◷" });
  }
  return (
    <div className="thinking-state">
      <div className="thinking-doodle" aria-hidden="true">
        <img src="/assets/doodles/katha-idle.webp" alt="" />
        <img
          className="thinking-wink"
          src="/assets/doodles/katha-wink.webp"
          alt=""
        />
      </div>
      <div>
        <span className="thinking-label">Thinking it through</span>
        {labels.size > 0 && (
          <div
            className="thinking-sources"
            aria-label="Evidence selected for this answer"
          >
            {[...labels.entries()].slice(0, 6).map(([id, s]) => (
              <span key={id} title={s.name}>
                {s.icon ? (
                  <img src={s.icon} alt="" />
                ) : (
                  <span aria-hidden="true" className="source-service-mark">
                    {s.glyph}
                  </span>
                )}
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
