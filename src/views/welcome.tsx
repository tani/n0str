import type { Event } from "nostr-tools";
import type { RelayInfo } from "../config/config.ts";
import { h, Fragment, escapeHtml } from "../utils/jsx.ts";

/**
 * Renders an individual event card.
 */
function EventCard({ event }: { event: Event }) {
  const avatarUrl = `https://robohash.org/${event.pubkey}?set=set4&size=48x48`;
  return (
    <div className="card mb-3 shadow-sm border-0 rounded-3 animate-fade-in">
      <div className="card-body">
        <div className="d-flex mb-2">
          <img
            src={avatarUrl}
            alt="avatar"
            className="rounded-circle me-3"
            width="48"
            height="48"
            style="background: #eee"
          />
          <div className="overflow-hidden">
            <div className="d-flex justify-content-between align-items-center">
              <small className="text-secondary text-truncate fw-bold" style="max-width: 150px;">
                {event.pubkey}
              </small>
              <small className="text-secondary ms-2">
                {new Date(event.created_at * 1000).toLocaleString()}
              </small>
            </div>
            <p className="card-text text-dark mt-1 event-content">{escapeHtml(event.content)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a system monitor widget with an SVG graph.
 */
function SystemMonitor({
  title,
  id,
  color,
  unit = "",
}: {
  title: string;
  id: string;
  color: string;
  unit?: string;
}) {
  return (
    <div
      className="bg-white p-3 shadow-sm rounded-3 mb-3 border-start border-4"
      style={`border-color: ${color} !important`}
    >
      <div className="d-flex justify-content-between align-items-center mb-1">
        <small
          className="text-secondary fw-bold text-uppercase"
          style="font-size: 0.7rem; letter-spacing: 0.05rem;"
        >
          {title}
        </small>
        <div>
          <span className="fw-bold fs-5" id={`${id}-value`}>
            0
          </span>
          <small className="text-secondary ms-1 fw-bold">{unit}</small>
        </div>
      </div>
      <div className="mt-1" style="height: 30px;">
        <svg
          viewBox="0 0 100 30"
          preserveAspectRatio="none"
          style="width: 100%; height: 100%; display: block; overflow: visible;"
        >
          <path
            id={`${id}-path`}
            d="M0 30 L100 30"
            fill="none"
            stroke={color}
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

/**
 * Renders the welcome page HTML.
 */
export function renderWelcomePage(
  events: Event[],
  info: RelayInfo,
  relayUrl: string,
  totalEvents: number = 0,
  connectedClients: number = 0,
  initialHeap: number = 0,
): string {
  const title = info.name || "n0str Relay";
  const description = info.description || "A simple, reliable Nostr relay.";

  const content = (
    <Fragment>
      {"<!DOCTYPE html>"}
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{title}</title>
          <link
            href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css"
            rel="stylesheet"
          />
          <style>
            {`
            .event-content { white-space: pre-wrap; word-break: break-word; font-size: 0.95rem; }
            .animate-fade-in { animation: fadeIn 0.4s ease-out; }
            @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            #feed::-webkit-scrollbar { width: 4px; }
            #feed::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
          `}
          </style>
        </head>
        <body className="bg-body-secondary">
          <header className="bg-white border-bottom py-5 mb-4 shadow-sm">
            <div className="container">
              <div className="row align-items-center">
                <div className="col-md-8 text-md-start text-center">
                  <h1 className="display-5 fw-bold mb-2">{title}</h1>
                  <p className="lead text-secondary mb-0">{description}</p>
                </div>
                <div className="col-md-4 text-md-end text-center mt-3 mt-md-0">
                  <div className="d-inline-flex align-items-center p-2 bg-light rounded-3 border shadow-sm">
                    <code id="relay-url" className="me-2 text-primary" style="font-size: 1.1rem;">
                      {relayUrl}
                    </code>
                    <button className="btn btn-sm btn-primary px-3 fw-bold" onclick="copyUrl()">
                      Copy
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </header>

          <main className="container pb-5">
            <div className="row">
              <section className="col-lg-8" id="feed">
                {events.length === 0 ? (
                  <div className="text-center py-5 text-secondary">
                    No events yet. Start the conversation!
                  </div>
                ) : (
                  events.map((e) => <EventCard event={e} />)
                )}
              </section>
              <aside className="col-lg-4">
                <div className="mb-4">
                  <h6
                    className="text-secondary fw-bold text-uppercase mb-3"
                    style="font-size: 0.75rem;"
                  >
                    System Monitor
                  </h6>
                  <SystemMonitor title="Active Connections" id="connections" color="#0d6efd" />
                  <SystemMonitor title="Heap Memory" id="memory" color="#6f42c1" unit="MB" />
                  <SystemMonitor title="Events / sec" id="ingest" color="#198754" />
                </div>

                <div className="bg-white p-4 shadow-sm rounded-3 mb-4 border-top border-4 border-primary">
                  <h5 className="fw-bold mb-3">Relay Status</h5>
                  <div className="d-flex justify-content-between mb-2">
                    <span>Total Events</span>
                    <span className="fw-bold text-primary" id="total-events">
                      {totalEvents}
                    </span>
                  </div>
                  <div className="d-flex justify-content-between mb-2">
                    <span>Software</span>
                    <small className="text-secondary">n0str v{info.version || "0.1.0"}</small>
                  </div>
                  <hr className="text-secondary opacity-25" />
                  <h5 className="fw-bold mb-3">Supported NIPs</h5>
                  <div className="d-flex flex-wrap gap-1">
                    {(info.supported_nips || []).map((nip) => (
                      <span
                        className="badge rounded-pill text-secondary border bg-light px-2 py-1"
                        style="font-size: 0.7rem;"
                      >
                        NIP-{nip}
                      </span>
                    ))}
                  </div>
                </div>

                {info.pubkey &&
                  info.pubkey !==
                    "0000000000000000000000000000000000000000000000000000000000000000" && (
                    <div className="bg-white p-4 shadow-sm rounded-3 border-top border-4 border-info">
                      <h5 className="fw-bold mb-3">Operator</h5>
                      <div className="text-truncate">
                        <small className="text-secondary">
                          <code className="text-primary">{info.pubkey}</code>
                        </small>
                      </div>
                    </div>
                  )}
              </aside>
            </div>
          </main>

          <script>
            {`
            const feed = document.getElementById('feed');
            const totalEventsEl = document.getElementById('total-events');
            const relayUrl = "${relayUrl}";
            let ws;
            let totalCount = ${totalEvents};
            let ingestCounter = 0;
            
            const stats = {
              connections: { 
                values: new Array(30).fill(${connectedClients}), 
                elValue: document.getElementById('connections-value'), 
                elPath: document.getElementById('connections-path'),
                current: ${connectedClients}
              },
              memory: { 
                values: new Array(30).fill(${initialHeap}), 
                elValue: document.getElementById('memory-value'), 
                elPath: document.getElementById('memory-path') 
              },
              ingest: { 
                values: new Array(30).fill(0), 
                elValue: document.getElementById('ingest-value'), 
                elPath: document.getElementById('ingest-path') 
              }
            };

            function copyUrl() {
              navigator.clipboard.writeText(relayUrl).then(() => {
                const btn = event.target;
                const originalText = btn.innerText;
                btn.innerText = 'Copied!';
                btn.classList.replace('btn-primary', 'btn-success');
                setTimeout(() => {
                  btn.innerText = originalText;
                  btn.classList.replace('btn-success', 'btn-primary');
                }, 2000);
              });
            }

            function updateGraph(stat, nextValue) {
              stat.values.push(nextValue);
              stat.values.shift();
              if (stat.elValue) stat.elValue.innerText = nextValue;
              
              const minInValues = Math.min(...stat.values);
              const maxInValues = Math.max(...stat.values);
              const range = Math.max(maxInValues - minInValues, 1);
              const padding = range * 0.2;
              
              const min = Math.max(0, minInValues - padding);
              const max = maxInValues + padding;
              const drawRange = max - min;

              const points = stat.values.map((v, i) => \`\${(i / (stat.values.length-1)) * 100},\${30 - ((v - min) / drawRange) * 25}\`).join(' L ');
              if (stat.elPath) stat.elPath.setAttribute('d', 'M ' + points);
            }

            async function pollStats() {
              try {
                const res = await fetch('/stats');
                const data = await res.json();
                stats.connections.current = data.clients;
                updateGraph(stats.memory, data.heapUsed);
              } catch (e) {
                console.error('Failed to poll stats', e);
              }
            }

            function connect() {
              ws = new WebSocket(relayUrl);
              ws.onopen = () => {
                ws.send(JSON.stringify(["REQ", "live-feed", { kinds: [1], limit: 0 }]));
              };
              ws.onmessage = (msgEvent) => {
                const msg = JSON.parse(msgEvent.data);
                if (msg[0] === 'EVENT') {
                  ingestCounter++;
                  if (msg[2].kind === 1) addEvent(msg[2]);
                }
              };
              ws.onclose = () => {
                setTimeout(connect, 5000);
              };
            }

            function addEvent(e) {
              const div = document.createElement('div');
              div.className = 'card mb-3 shadow-sm border-0 rounded-3 animate-fade-in';
              const date = new Date(e.created_at * 1000).toLocaleString();
              const escapedContent = e.content.replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
              const avatarUrl = 'https://robohash.org/' + e.pubkey + '?set=set4&size=48x48';
              
              div.innerHTML = \`
                <div class="card-body">
                  <div class="d-flex mb-2">
                    <img src="\${avatarUrl}" alt="avatar" class="rounded-circle me-3" width="48" height="48" style="background: #eee">
                    <div class="overflow-hidden">
                      <div class="d-flex justify-content-between align-items-center">
                        <small class="text-secondary text-truncate fw-bold" style="max-width: 150px;">\${e.pubkey}</small>
                        <small class="text-secondary ms-2">\${date}</small>
                      </div>
                      <p class="card-text text-dark mt-1" style="white-space: pre-wrap; word-break: break-word; font-size: 0.95rem;">\${escapedContent}</p>
                    </div>
                  </div>
                </div>
              \`;
              
              if (feed.firstChild && feed.firstChild.classList && feed.firstChild.classList.contains('text-secondary')) {
                feed.innerHTML = '';
              }
              
              feed.prepend(div);
              totalCount++;
              if (totalEventsEl) totalEventsEl.innerText = totalCount;
              if (feed.children.length > 200) feed.lastElementChild.remove();
            }

            // Initialization
            updateGraph(stats.connections, stats.connections.current);
            updateGraph(stats.ingest, 0);
            updateGraph(stats.memory, ${initialHeap});

            setInterval(() => {
              updateGraph(stats.ingest, ingestCounter);
              ingestCounter = 0;
              updateGraph(stats.connections, stats.connections.current);
            }, 1000);

            setInterval(pollStats, 2000);

            connect();
          `}
          </script>
        </body>
      </html>
    </Fragment>
  );

  return content;
}
