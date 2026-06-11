/**
 * "Så funkar det" — a one-page infographic explaining the concept and the pacing
 * model in plain Swedish. Reachable from the header and via the #sa-funkar-det hash
 * so a shared link lands here directly. Light-mode only, matching the app palette.
 *
 * Copy is grounded in packages/core (physics.ts, chaingang.ts, planner.ts,
 * weather/effective.ts). Medium depth: concept first, one explained formula where it
 * adds credibility. Figures are hand-authored inline SVGs.
 */
import type { ReactNode } from 'react';

const REPO_URL = 'https://github.com/timcv/StickToThePlan';

// App palette (light mode only), plus a few figure-only accents.
const C = {
  accent: '#1f6feb',
  text: '#1c2430',
  muted: '#5b6675',
  border: '#d8dce3',
  fill: '#e7f0ff',
  coral: '#e8590c',
  gray: '#868e96',
  green: '#2b8a3e',
};

function Section({
  title,
  children,
  figure,
}: {
  title: string;
  children: ReactNode;
  figure?: ReactNode;
}) {
  return (
    <section className="howto-section">
      <h2>{title}</h2>
      {children}
      {figure ? <div className="howto-figure">{figure}</div> : null}
    </section>
  );
}

function Formula({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <>
      <div className="howto-formula">{children}</div>
      <p className="howto-caption">{caption}</p>
    </>
  );
}

function DeepDive({ children }: { children: ReactNode }) {
  return (
    <details className="howto-deep">
      <summary>Fördjupning: exakta formler</summary>
      <div className="howto-deep-body">{children}</div>
    </details>
  );
}

/* ---- Figures ---- */

function GrundidenFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 168" role="img" aria-labelledby="fig1-t fig1-d">
      <title id="fig1-t">Höjdprofil med en jämn ansträngningslinje</title>
      <desc id="fig1-d">
        En bergig vägprofil med en rak streckad linje ovanför som visar att ansträngningen hålls
        konstant medan vägen går upp och ner.
      </desc>
      <polygon
        points="40,150 40,108 150,66 250,116 350,52 470,124 560,82 640,116 640,150"
        fill={C.fill}
        stroke={C.accent}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <line
        x1="40"
        y1="40"
        x2="640"
        y2="40"
        stroke={C.accent}
        strokeWidth="2"
        strokeDasharray="6 5"
      />
      <text x="40" y="30" fontSize="13" fontWeight="600" fill={C.accent}>
        Jämn ansträngning (watt)
      </text>
      <text x="640" y="164" fontSize="12" fill={C.muted} textAnchor="end">
        Vägen går upp och ner, men effekten är densamma
      </text>
    </svg>
  );
}

function ForcesFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 226" role="img" aria-labelledby="fig2-t fig2-d">
      <title id="fig2-t">Cyklist med tre motståndskrafter</title>
      <desc id="fig2-d">
        En cyklist på en svag uppförsbacke med tre bakåtriktade pilar: ett stort luftmotstånd, ett
        mindre rullmotstånd och tyngden nedåt, samt en framåtriktad pil för tramplkraften.
      </desc>
      <defs>
        <marker
          id="hw-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>

      <line
        x1="120"
        y1="178"
        x2="560"
        y2="126"
        stroke={C.border}
        strokeWidth="2"
        strokeLinecap="round"
      />

      <circle cx="330" cy="156" r="16" fill="none" stroke={C.text} strokeWidth="2" />
      <circle cx="402" cy="148" r="16" fill="none" stroke={C.text} strokeWidth="2" />
      <path
        d="M330 156 L366 124 L402 148 M366 124 L352 156"
        fill="none"
        stroke={C.text}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <line
        x1="352"
        y1="124"
        x2="392"
        y2="120"
        stroke={C.text}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="366"
        y1="124"
        x2="356"
        y2="108"
        stroke={C.text}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="356" cy="101" r="7" fill="none" stroke={C.text} strokeWidth="2" />

      <line
        x1="345"
        y1="100"
        x2="206"
        y2="100"
        stroke={C.accent}
        strokeWidth="3"
        markerEnd="url(#hw-arrow)"
      />
      <text x="206" y="90" fontSize="13" fontWeight="600" fill={C.accent}>
        Luftmotstånd (störst)
      </text>

      <line
        x1="320"
        y1="176"
        x2="252"
        y2="176"
        stroke={C.gray}
        strokeWidth="2"
        markerEnd="url(#hw-arrow)"
      />
      <text x="252" y="194" fontSize="13" fill={C.muted}>
        Rullmotstånd
      </text>

      <line
        x1="366"
        y1="160"
        x2="366"
        y2="206"
        stroke={C.coral}
        strokeWidth="2.5"
        markerEnd="url(#hw-arrow)"
      />
      <text x="376" y="200" fontSize="13" fill={C.coral}>
        Tyngd i backen
      </text>

      <line
        x1="418"
        y1="138"
        x2="480"
        y2="138"
        stroke={C.green}
        strokeWidth="2.5"
        markerEnd="url(#hw-arrow)"
      />
      <text x="486" y="142" fontSize="13" fill={C.green}>
        Du trampar
      </text>
    </svg>
  );
}

function WindFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 200" role="img" aria-labelledby="fig3-t fig3-d">
      <title id="fig3-t">Vinden delas upp i motvind och sidvind</title>
      <desc id="fig3-d">
        En pil för färdriktningen längs vägen och en pil för vinden som kommer snett emot, uppdelad
        i en motvindskomponent längs vägen och en sidvindskomponent tvärs vägen.
      </desc>
      <defs>
        <marker
          id="w-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>

      <line
        x1="120"
        y1="150"
        x2="520"
        y2="150"
        stroke={C.border}
        strokeWidth="10"
        strokeLinecap="round"
      />
      <line
        x1="300"
        y1="150"
        x2="430"
        y2="150"
        stroke={C.green}
        strokeWidth="3"
        markerEnd="url(#w-arrow)"
      />
      <text x="360" y="174" fontSize="13" fill={C.green} textAnchor="middle">
        Färdriktning
      </text>

      <line
        x1="250"
        y1="50"
        x2="330"
        y2="150"
        stroke={C.accent}
        strokeWidth="3"
        markerEnd="url(#w-arrow)"
      />
      <text x="232" y="46" fontSize="13" fontWeight="600" fill={C.accent} textAnchor="end">
        Vind
      </text>

      <line
        x1="330"
        y1="150"
        x2="250"
        y2="150"
        stroke={C.coral}
        strokeWidth="2.5"
        strokeDasharray="5 4"
        markerEnd="url(#w-arrow)"
      />
      <text x="248" y="142" fontSize="12" fill={C.coral} textAnchor="end">
        Motvind
      </text>

      <line
        x1="330"
        y1="150"
        x2="330"
        y2="60"
        stroke={C.muted}
        strokeWidth="2.5"
        strokeDasharray="5 4"
        markerEnd="url(#w-arrow)"
      />
      <text x="340" y="74" fontSize="12" fill={C.muted}>
        Sidvind
      </text>
    </svg>
  );
}

function PacelineFigure() {
  const riders = [120, 215, 310, 405, 500];
  return (
    <svg width="100%" viewBox="0 0 680 150" role="img" aria-labelledby="fig4-t fig4-d">
      <title id="fig4-t">Kedjegäng med en cyklist på täten</title>
      <desc id="fig4-d">
        Fem cyklister i en rad som rör sig åt höger. Den främre ligger på täten i full vind, de
        bakom ligger i lä med ungefär en tredjedel lägre luftmotstånd.
      </desc>
      <defs>
        <marker
          id="p-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {riders.map((cx, i) => {
        const lead = i === riders.length - 1;
        return (
          <g key={cx}>
            <circle
              cx={cx}
              cy="86"
              r="15"
              fill="none"
              stroke={lead ? C.accent : C.gray}
              strokeWidth="2"
            />
            <circle
              cx={cx + 26}
              cy="86"
              r="15"
              fill="none"
              stroke={lead ? C.accent : C.gray}
              strokeWidth="2"
            />
            <path
              d={`M${cx} 86 L${cx + 13} 60 L${cx + 26} 86 M${cx + 13} 60 L${cx + 6} 86`}
              fill="none"
              stroke={lead ? C.accent : C.gray}
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle
              cx={cx + 16}
              cy="50"
              r="6"
              fill="none"
              stroke={lead ? C.accent : C.gray}
              strokeWidth="2"
            />
          </g>
        );
      })}
      <line
        x1="540"
        y1="74"
        x2="600"
        y2="74"
        stroke={C.green}
        strokeWidth="2.5"
        markerEnd="url(#p-arrow)"
      />
      <text x="516" y="34" fontSize="13" fontWeight="600" fill={C.accent}>
        På täten: full vind
      </text>
      <text x="120" y="128" fontSize="13" fill={C.muted}>
        I lä: ungefär 35 % lägre luftmotstånd
      </text>
    </svg>
  );
}

function SolverFigure() {
  const steps = [
    { x: 30, label: 'Gissa', sub: 'ansträngning' },
    { x: 198, label: 'Kör', sub: 'rutten sträcka för sträcka' },
    { x: 366, label: 'Summera', sub: 'total tid' },
    { x: 534, label: 'Träffar', sub: 'måltiden?' },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 168" role="img" aria-labelledby="fig5-t fig5-d">
      <title id="fig5-t">Lösarens slinga</title>
      <desc id="fig5-d">
        Fyra steg i rad: gissa en ansträngning, kör rutten, summera tiden och se om den träffar
        målet. En pil tillbaka visar att ansträngningen justeras och slingan körs om tills tiden
        stämmer.
      </desc>
      <defs>
        <marker
          id="s-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {steps.map((s, i) => (
        <g key={s.label}>
          <rect
            x={s.x}
            y="34"
            width="116"
            height="52"
            rx="8"
            fill={C.fill}
            stroke={C.accent}
            strokeWidth="1"
          />
          <text
            x={s.x + 58}
            y="58"
            fontSize="13"
            fontWeight="600"
            fill={C.text}
            textAnchor="middle"
          >
            {s.label}
          </text>
          <text x={s.x + 58} y="74" fontSize="11" fill={C.muted} textAnchor="middle">
            {s.sub}
          </text>
          {i < steps.length - 1 ? (
            <line
              x1={s.x + 116}
              y1="60"
              x2={s.x + 168}
              y2="60"
              stroke={C.muted}
              strokeWidth="1.5"
              markerEnd="url(#s-arrow)"
            />
          ) : null}
        </g>
      ))}
      <path
        d="M592 86 L592 128 L88 128 L88 90"
        fill="none"
        stroke={C.coral}
        strokeWidth="1.5"
        strokeDasharray="5 4"
        markerEnd="url(#s-arrow)"
      />
      <text x="340" y="148" fontSize="12" fill={C.coral} textAnchor="middle">
        Justera ansträngningen och kör om tills tiden stämmer med målet
      </text>
    </svg>
  );
}

function ScenarioFigure() {
  const rows = [
    { y: 44, label: 'Optimistiskt', sub: 'lugnare vind', len: 280, color: C.green },
    { y: 92, label: 'Förväntat', sub: 'väntad vind', len: 360, color: C.accent },
    { y: 140, label: 'Pessimistiskt', sub: 'kraftigare vind', len: 440, color: C.coral },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 200" role="img" aria-labelledby="fig6-t fig6-d">
      <title id="fig6-t">Tre vindscenarier ger tre sluttider</title>
      <desc id="fig6-d">
        Tre staplar som visar sluttiden vid lugnare, väntad och kraftigare vind. Lugnare vind ger
        kortast tid, kraftigare vind längst tid.
      </desc>
      <defs>
        <marker
          id="sc-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {rows.map((r) => (
        <g key={r.label}>
          <text x="30" y={r.y + 4} fontSize="13" fontWeight="600" fill={C.text}>
            {r.label}
          </text>
          <text x="30" y={r.y + 20} fontSize="11" fill={C.muted}>
            {r.sub}
          </text>
          <rect
            x="170"
            y={r.y - 10}
            width={r.len}
            height="22"
            rx="5"
            fill={r.color}
            opacity="0.9"
          />
        </g>
      ))}
      <line
        x1="170"
        y1="172"
        x2="626"
        y2="172"
        stroke={C.muted}
        strokeWidth="1"
        markerEnd="url(#sc-arrow)"
      />
      <text x="170" y="191" fontSize="11" fill={C.muted}>
        kortare tid
      </text>
      <text x="626" y="191" fontSize="11" fill={C.muted} textAnchor="end">
        längre tid
      </text>
    </svg>
  );
}

function SegmentFigure() {
  const ticks = Array.from({ length: 40 }, (_, i) => 42 + i * 15);
  const bars = [
    { x: 42, w: 150, label: 'Flackt', color: C.accent },
    { x: 200, w: 96, label: 'Klättring', color: C.coral },
    { x: 304, w: 150, label: 'Flackt', color: C.accent },
    { x: 462, w: 174, label: 'Depå', color: C.green },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 180" role="img" aria-labelledby="seg-t seg-d">
      <title id="seg-t">Hundratals mikrosegment grupperas till några få tempokortsrader</title>
      <desc id="seg-d">
        En rad med många tunna streck som visar mikrosegment, en pil nedåt, och nedanför några få
        breda etiketterade rader med markörer för kontroll och depå.
      </desc>
      <defs>
        <marker
          id="seg-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      {ticks.map((x) => (
        <line key={x} x1={x} y1="22" x2={x} y2="52" stroke={C.gray} strokeWidth="1.5" />
      ))}
      <text x="42" y="16" fontSize="11" fill={C.muted}>
        Mikrosegment (ett per GPX-punkt)
      </text>
      <line
        x1="340"
        y1="60"
        x2="340"
        y2="88"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#seg-arrow)"
      />
      {bars.map((b) => (
        <g key={b.x}>
          <rect x={b.x} y="100" width={b.w - 6} height="28" rx="5" fill={b.color} opacity="0.85" />
          <text
            x={b.x + (b.w - 6) / 2}
            y="118"
            fontSize="12"
            fill="#fff"
            textAnchor="middle"
            fontWeight="600"
          >
            {b.label}
          </text>
        </g>
      ))}
      <circle cx="296" cy="100" r="5" fill={C.text} />
      <circle cx="630" cy="100" r="5" fill={C.text} />
      <text x="42" y="150" fontSize="11" fill={C.muted}>
        Visningssegment: ny rad där kontroll, lutning eller vind ändras
      </text>
    </svg>
  );
}

function WeatherClockFigure() {
  const pts = [
    { x: 90, y: 150, t: '05:00', len: 16 },
    { x: 340, y: 96, t: '10:00', len: 30 },
    { x: 600, y: 120, t: '15:00', len: 46 },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 196" role="img" aria-labelledby="wx-t wx-d">
      <title id="wx-t">Vinden ökar längs rutten under dagen</title>
      <desc id="wx-d">
        En båge som visar rutten med tre klockmarkörer. Vid varje punkt en vindpil som blir längre
        och vrider sig, från lugn morgon till blåsig eftermiddag.
      </desc>
      <defs>
        <marker
          id="wx-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <path d="M60 160 Q340 40 620 132" fill="none" stroke={C.border} strokeWidth="3" />
      {pts.map((p) => (
        <g key={p.t}>
          <circle cx={p.x} cy={p.y} r="5" fill={C.accent} />
          <text
            x={p.x}
            y={p.y + 22}
            fontSize="12"
            fill={C.text}
            textAnchor="middle"
            fontWeight="600"
          >
            {p.t}
          </text>
          <line
            x1={p.x}
            y1={p.y - 8}
            x2={p.x + p.len}
            y2={p.y - 8 - p.len * 0.5}
            stroke={C.coral}
            strokeWidth="2.5"
            markerEnd="url(#wx-arrow)"
          />
        </g>
      ))}
      <text x="60" y="186" fontSize="12" fill={C.muted}>
        Lugn morgon
      </text>
      <text x="620" y="186" fontSize="12" fill={C.coral} textAnchor="end" fontWeight="600">
        Blåsig eftermiddag
      </text>
    </svg>
  );
}

function RoadPrepFigure() {
  const raw =
    '40,120 90,96 140,128 190,84 240,150 290,92 340,116 390,70 440,150 490,104 560,88 640,108';
  const smooth = '40,116 140,112 240,118 340,100 440,108 560,96 640,104';
  return (
    <svg width="100%" viewBox="0 0 680 176" role="img" aria-labelledby="road-t road-d">
      <title id="road-t">Rå höjdkurva jämnas ut och brant lutning klampas</title>
      <desc id="road-d">
        En taggig rå höjdkurva med en utjämnad linje ovanpå, en avhuggen spik som visar
        lutningstaket, och en markerad neutral första kilometer.
      </desc>
      <rect x="40" y="40" width="80" height="120" fill={C.fill} opacity="0.7" />
      <text x="44" y="56" fontSize="11" fill={C.muted}>
        Neutral km
      </text>
      <polyline points={raw} fill="none" stroke={C.gray} strokeWidth="1.5" strokeDasharray="4 3" />
      <polyline
        points={smooth}
        fill="none"
        stroke={C.accent}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <line
        x1="380"
        y1="70"
        x2="400"
        y2="64"
        stroke={C.coral}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <text x="392" y="56" fontSize="12" fill={C.coral}>
        klampad till ±18 %
      </text>
      <text x="44" y="172" fontSize="12" fill={C.gray}>
        Rå GPX-höjd
      </text>
      <text x="640" y="172" fontSize="12" fill={C.accent} textAnchor="end" fontWeight="600">
        Utjämnad profil
      </text>
    </svg>
  );
}

function AnchorFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 176" role="img" aria-labelledby="anchor-t anchor-d">
      <title id="anchor-t">Två vägar till ett referensankare</title>
      <desc id="anchor-d">
        En lång tur över två timmar ger turens normaliserade effekt direkt; en kort tur eller ingen
        fil ger 0,60 gånger FTP. Båda landar i ett referensankare vid sidan av tidslösaren.
      </desc>
      <defs>
        <marker
          id="an-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path
            d="M2 1L8 5L2 9"
            fill="none"
            stroke="context-stroke"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <rect
        x="30"
        y="34"
        width="210"
        height="40"
        rx="8"
        fill={C.fill}
        stroke={C.accent}
        strokeWidth="1"
      />
      <text x="135" y="50" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Lång representativ tur ({'>'}2 h)
      </text>
      <text x="135" y="66" fontSize="11" fill={C.muted} textAnchor="middle">
        turens NP används direkt
      </text>
      <rect
        x="30"
        y="102"
        width="210"
        height="40"
        rx="8"
        fill="#fff"
        stroke={C.gray}
        strokeWidth="1"
      />
      <text x="135" y="118" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Kort test eller ingen fil
      </text>
      <text x="135" y="134" fontSize="11" fill={C.muted} textAnchor="middle">
        0,60 × FTP
      </text>
      <line
        x1="240"
        y1="54"
        x2="372"
        y2="80"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#an-arrow)"
      />
      <line
        x1="240"
        y1="122"
        x2="372"
        y2="92"
        stroke={C.muted}
        strokeWidth="1.5"
        markerEnd="url(#an-arrow)"
      />
      <rect
        x="380"
        y="64"
        width="150"
        height="44"
        rx="8"
        fill={C.fill}
        stroke={C.accent}
        strokeWidth="1.5"
      />
      <text x="455" y="82" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        Referensankare
      </text>
      <text x="455" y="98" fontSize="11" fill={C.muted} textAnchor="middle">
        visas i planen
      </text>
      <line
        x1="530"
        y1="86"
        x2="600"
        y2="86"
        stroke={C.green}
        strokeWidth="2.5"
        markerEnd="url(#an-arrow)"
      />
      <text x="610" y="82" fontSize="11" fill={C.green} textAnchor="end">
        tidslösaren
      </text>
      <text x="610" y="98" fontSize="11" fill={C.green} textAnchor="end">
        räknar ändå NP
      </text>
    </svg>
  );
}

function EtaClockFigure() {
  return (
    <svg width="100%" viewBox="0 0 680 150" role="img" aria-labelledby="eta-t eta-d">
      <title id="eta-t">Tidslinje med ankomst, depåstopp och avgång</title>
      <desc id="eta-d">
        En vågrät tidslinje från start till mål med en kontrollpunkt, ett markerat depåstopp som
        skjuter klockan framåt, och en avgångstid efter stoppet.
      </desc>
      <line x1="40" y1="80" x2="640" y2="80" stroke={C.border} strokeWidth="3" />
      <circle cx="60" cy="80" r="6" fill={C.accent} />
      <text x="60" y="64" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        04:22
      </text>
      <text x="60" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Start
      </text>
      <circle cx="300" cy="80" r="6" fill={C.text} />
      <text x="300" y="64" fontSize="12" fill={C.text} textAnchor="middle" fontWeight="600">
        07:22
      </text>
      <text x="300" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Ankomst depå
      </text>
      <rect x="300" y="74" width="90" height="12" fill={C.coral} opacity="0.85" />
      <text x="345" y="124" fontSize="11" fill={C.coral} textAnchor="middle">
        +15 min stopp
      </text>
      <circle cx="390" cy="80" r="6" fill={C.green} />
      <text x="390" y="64" fontSize="12" fill={C.green} textAnchor="middle" fontWeight="600">
        07:37
      </text>
      <text x="390" y="108" fontSize="11" fill={C.muted} textAnchor="middle">
        Avgång
      </text>
      <circle cx="640" cy="80" r="6" fill={C.accent} />
      <text x="640" y="64" fontSize="12" fill={C.text} textAnchor="end" fontWeight="600">
        Mål
      </text>
    </svg>
  );
}

export function HowItWorks({ onBack }: { onBack: () => void }) {
  return (
    <div className="howto">
      <header className="howto-hero">
        <h1>Så räknar StickToThePlan ut din tid</h1>
        <p>
          Vi håller din ansträngning jämn och låter farten variera med backar och vind. Sedan letar
          vi fram exakt den ansträngning som tar dig i mål på utsatt tid.
        </p>
      </header>

      <Section title="Grundidén" figure={<GrundidenFigure />}>
        <p>
          Backar bromsar, utförslöpor och medvind hjälper. I stället för en jämn fart håller vi en
          jämn effekt (watt). Farten får variera, men känslan i benen är i stort sett densamma hela
          varvet. Det är så en van cyklist faktiskt kör: lika hårt uppför som nerför, inte lika
          fort.
        </p>
      </Section>

      <Section title="Från GPX till väg" figure={<RoadPrepFigure />}>
        <p>
          Din GPX är en lista med punkter. Vi rensar dubblerade punkter, jämnar ut höjden med ett
          glidande medel så att barometerbrus inte blir falska backar, och delar rutten i hundratals
          små bitar. För varje bit räknar vi lutningen ur höjdskillnaden, och klampar orimligt
          branta värden så att en GPS-spik inte blåser upp effektkravet. Första kilometern är
          neutral: en lugn rullstart på 20 km/h utanför ansträngningsmodellen, precis som
          masstarten.
        </p>
        <Formula caption="Utan utjämning skulle varje liten höjdvariation läsas som en backe och störa effektberäkningen.">
          lutning = höjdskillnad ÷ sträcka, klampad till ±18 %
        </Formula>
        <DeepDive>
          <p>Höjden filtreras med ett glidande medel innan lutningen beräknas per mikrosegment:</p>
          <div className="howto-formula howto-formula-block">
            {'höjd_utjämnad = glidande medel över 5 punkter\n'}
            {'lutning = (höjd_slut − höjd_start) ÷ längd\n'}
            {'lutning klampas till [−0,18, 0,18]  (±18 %)\n'}
            {'neutral: cum_distans < 1 km → 20 km/h, utanför NP-modellen'}
          </div>
          <p>
            Parametrar: utjämningsfönster 5 punkter, lutningstak 18 %, neutral sträcka 1 km vid 20
            km/h. Sammanfallande punkter tas bort först så att en stillastående logg inte ger
            nolldistans-bitar.
          </p>
        </DeepDive>
      </Section>

      <Section title="Tre krafter du trampar mot" figure={<ForcesFigure />}>
        <p>
          Varje sekund räknar vi hur många watt som krävs för att övervinna tre motstånd: tyngden i
          backen, däcken mot asfalten och luften framför dig. Luftmotståndet är i särklass störst på
          platt mark.
        </p>
        <Formula caption="Luftmotståndet växer med farten i kvadrat, därför betyder vind och kroppshållning så mycket.">
          effekt = (backe + rull + luft) × fart ÷ verkningsgrad
        </Formula>
        <DeepDive>
          <p>
            Effekten vid tramporna för fart <var>v</var>, lutning och vind beräknas stationärt
            (physics.ts):
          </p>
          <div className="howto-formula howto-formula-block">
            {'θ = atan(lutning)\n'}
            {'F_gravitation = m · g · sin θ\n'}
            {'F_rull = m · g · cos θ · crr\n'}
            {'u = v + motvind (axiell skenbar vind)\n'}
            {'v_app = √(u² + sidvind²)\n'}
            {'F_luft = ½ · ρ · CdA · v_app · u\n'}
            {'P = (F_gravitation + F_rull + F_luft) · v ÷ η'}
          </div>
          <p>
            Sidvind höjer dessutom effektiv CdA med yaw-vinkeln: CdA·(1 + 0,04·|yaw°|/10), cirka +8
            % vid 20° yaw, klampad till ±50°. Fart ur effekt löses med bisektion på [0,5, 25] m/s
            till 0,01 W.
          </p>
          <table>
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Standardvärde</th>
                <th>Betydelse</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>m</td>
                <td>96 kg</td>
                <td>cyklist + cykel</td>
              </tr>
              <tr>
                <td>crr</td>
                <td>0,0045</td>
                <td>rullmotståndskoefficient</td>
              </tr>
              <tr>
                <td>CdA</td>
                <td>0,32 / 0,21 m²</td>
                <td>på täten / i lä</td>
              </tr>
              <tr>
                <td>η</td>
                <td>0,97</td>
                <td>drivlinans verkningsgrad</td>
              </tr>
              <tr>
                <td>g</td>
                <td>9,81 m/s²</td>
                <td>tyngdacceleration</td>
              </tr>
            </tbody>
          </table>
        </DeepDive>
      </Section>

      <Section title="Luft, vind och terräng" figure={<WindFigure />}>
        <p>
          Tung luft bromsar mer än lätt, så vi väger in temperatur och lufttryck. Vindprognosen
          gäller 10 meter upp, men du sitter på drygt en meter. Vi skalar ner vinden efter hur
          skyddat landskapet är: skog och bebyggelse dämpar, öppet vatten och broar släpper fram
          full vind. Sido- och motvind kostar olika mycket, så vi delar upp vinden i mot- och sidled
          för varje vägsträcka.
        </p>
        <Formula caption="Terrängfaktorn kommer ur en standardmodell för hur vind avtar nära marken (logaritmisk vindprofil).">
          effektiv vind = prognosvind × terrängfaktor
        </Formula>
        <DeepDive>
          <p>Lufttäthet ur temperatur och tryck (ideala gaslagen, torr luft):</p>
          <div className="howto-formula howto-formula-block">
            {'ρ = p ÷ (Rd · T)    Rd = 287,058 J/(kg·K), T i kelvin'}
          </div>
          <p>
            Vid fuktig luft kan modellen korrigera med virtuell temperatur T<sub>v</sub> = T ÷ (1 −
            (e/p)(1 − Rd/Rv)), där Rv = 461,5 J/(kg·K) och ångtrycket e = RH · e<sub>s</sub> med
            Tetens approximation e<sub>s</sub> = 611,2 · exp(17,67(T−273,15)/(T−29,65)) Pa. Effekten
            är liten, upp till ungefär en halv procent vid typiskt loppväder.
          </p>
          <p>Vinden delas upp mot färdriktningen (Δ = vindriktning − kurs):</p>
          <div className="howto-formula howto-formula-block">
            {'motvind = W · cos Δ\nsidvind = W · sin Δ'}
          </div>
          <p>
            Prognosvind (10 m) skalas till styrhöjd (1,2 m) med neutral logaritmisk vindprofil,
            faktorn klampas till [0,15, 1]:
          </p>
          <div className="howto-formula howto-formula-block">
            {'faktor = ln(1,2 ÷ z0) ÷ ln(10 ÷ z0)'}
          </div>
          <p>
            z0 är terrängens råhetslängd. Standardrutten har exponeringsklass per vägsegment ur
            OpenStreetMap enligt den finare skalan i tabellen nedan. Uppladdade rutter får i stället
            en grövre schablon för hela rutten med egna värden: öppet 0,03, blandat 0,05 eller
            skyddat 0,3 m.
          </p>
          <table>
            <thead>
              <tr>
                <th>Exponeringsklass</th>
                <th>z0 (m)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>vatten</td>
                <td>0,001</td>
              </tr>
              <tr>
                <td>bro</td>
                <td>0,002</td>
              </tr>
              <tr>
                <td>öppet</td>
                <td>0,03</td>
              </tr>
              <tr>
                <td>halvöppet</td>
                <td>0,08</td>
              </tr>
              <tr>
                <td>skog</td>
                <td>0,3</td>
              </tr>
              <tr>
                <td>bebyggelse</td>
                <td>0,4</td>
              </tr>
              <tr>
                <td>skyddat</td>
                <td>0,5</td>
              </tr>
            </tbody>
          </table>
        </DeepDive>
      </Section>

      <Section title="Vädret skiftar över dygnet" figure={<WeatherClockFigure />}>
        <p>
          Vädret är inte en enda siffra för hela loppet. För varje sträcka slår vi upp vinden på
          just den platsen och vid den timme på dygnet du faktiskt är där. Ett varv tar runt elva
          timmar, så en lugn morgonstart kan möta helt annan vind på eftermiddagen. Prognosen läggs
          i ett rutnät i både rum och tid, och vi sparar uppslagen per cell och timme så att
          tusentals sträckor går snabbt att räkna.
        </p>
        <Formula caption="Klockan du når en plats avgör vilken prognostimme som gäller där, inte klockan vid start.">
          timme på platsen = starttid + din restid dit
        </Formula>
        <DeepDive>
          <p>
            Klocktiden vid en sträcka är starttiden plus ackumulerad restid. Den mappas till en
            heltimme och en cell i rutnätet (väderceller lagras i UTC):
          </p>
          <div className="howto-formula howto-formula-block">
            {'timme = ⌊(startklocka_UTC + förfluten_tid_s) ÷ 3600⌋ mod 24\n'}
            {'cellnyckel = lat | lon | timme  (närmaste cell, exakt cache)'}
          </div>
          <p>
            Ensemblen aggregeras till celler i rum och tid; uppslag per (lat, lon, timme) cachas så
            att den haversine-tunga sökningen bara körs en gång per cell. Den uppströms
            prognoshämtningen cachas i sin tur i 3 timmar.
          </p>
        </DeepDive>
      </Section>

      <Section title="I grupp: lä och jämn ansträngning" figure={<PacelineFigure />}>
        <p>
          I ett kedjegäng ligger du mest i lä, där luftmotståndet är ungefär en tredjedel lägre. Vi
          modellerar rotationen: korta, hårda drag på täten och längre återhämtning i hjul. För att
          fånga vad det gör med kroppen mäter vi din ansträngning som normaliserad effekt (NP), ett
          mått som straffar de hårda dragen hårdare än ett vanligt snitt gör.
        </p>
        <Formula caption="Upphöjt till fyra gör att korta hårda drag väger tyngre, precis som de känns i benen.">
          NP = (medel av 30-sekunders rullande effekt⁴)^¼
        </Formula>
        <DeepDive>
          <p>
            Med <var>n</var> cyklister och 45 s drag är andelen tid på täten f_front = 1/n (solo:
            1,0). Tidsmedeleffekten:
          </p>
          <div className="howto-formula howto-formula-block">
            {'P_medel = f_front · P_täten + (1 − f_front) · P_lä'}
          </div>
          <p>
            Rotationen modelleras som en fyrkantvåg: 45 s på täten med P<sub>täten</sub> (CdA 0,32),
            resten av cykeln i lä med P<sub>lä</sub> (CdA 0,21). Normaliserad effekt är 30 sekunders
            rullande medel, upphöjt till fyra och medelvärdesbildat; fjärderoten ger NP. För
            fyrkantvågen finns en sluten form: varje rullande fönster är en konvex blandning a·P
            <sub>täten</sub> + (1−a)·P<sub>lä</sub>, så NP⁴ blir ett polynom i de två effekterna (Pt
            = P_täten, Pl = P_lä) med förberäknade momentkoefficienter:
          </p>
          <div className="howto-formula howto-formula-block">
            {'NP = (c₄·Pt⁴ + c₃·Pt³·Pl + c₂·Pt²·Pl² + c₁·Pt·Pl³ + c₀·Pl⁴)^¼'}
          </div>
          <p>
            Det gör utvärderingen O(1) per fart i stället för en sampelsimulering, verifierad mot
            referensimplementationen inom 10⁻⁶. Farten som ger mål-NP löses med bisektion till 0,1
            W.
          </p>
        </DeepDive>
      </Section>

      <Section title="Vilken ansträngning planen håller" figure={<AnchorFigure />}>
        <p>
          Du kan ladda upp en valfri effektfil (FIT) från en representativ tur. Är den lång (mer än
          två timmar) använder vi turens normaliserade effekt som ett personligt ankare; är den
          kort, eller saknas helt, faller vi tillbaka på 0,60 × FTP. Ankaret är ett referensvärde
          som visas i planen så att du ser vilken ansträngning din måltid ungefär motsvarar. Själva
          planen löser ändå fram exakt den ansträngning som krävs för att träffa din tid, så ankaret
          styr inte tempot, det är till för att stämma av att kravet är rimligt för dig.
        </p>
        <Formula caption="Normaliserad effekt är gruppstorleks-oberoende, så samma ankare gäller oavsett om ni är 8 eller 12 i gänget.">
          ankare = lång tur ({'>'}2 h) ? turens NP : 0,60 × FTP
        </Formula>
        <DeepDive>
          <p>Ankaret bestäms ur effektströmmen (fit.ts), klassad på längd:</p>
          <div className="howto-formula howto-formula-block">
            {'längd > 7200 s  → long_representative → np_target = turens NP\n'}
            {'längd ≤ 7200 s  → short_test          → np_target = 0,60 × FTP\n'}
            {'ingen fil                              → np_target = 0,60 × FTP'}
          </div>
          <p>
            Förar-NP är det gruppstorleks-oberoende fysiologiska ankaret (spec 8.1): en referenstur
            i ett gäng på 8 (turtäthet 1/8) översätts till en plan för 12 (1/12) utan omräkning av
            ankaret. I webbflödet är ankaret informativt och visas i plan.json; tidslösaren
            bisekterar ändå mål-NP i intervallet [60, FTP] för att träffa måltiden (se nästa
            avsnitt).
          </p>
        </DeepDive>
      </Section>

      <Section title="Hur vi räknar fram din tid" figure={<SolverFigure />}>
        <p>
          Vi gissar en ansträngningsnivå, kör igenom hela rutten sträcka för sträcka, räknar fart
          och tid på varje, och summerar. Blev det för långsamt höjer vi ansträngningen, för snabbt
          sänker vi den, och justerar oss närmare tills tiden stämmer med ditt mål. Realistiska
          effekttak gör att planen aldrig kräver orimligt hårda drag i branta backar eller farter
          över 50 km/h.
        </p>
        <DeepDive>
          <p>
            Två kapslade bisektioner. Inre lösaren marscherar rutten mikrosegment för mikrosegment:
          </p>
          <div className="howto-formula howto-formula-block">
            {'för varje segment:\n'}
            {'  väder(lat, lon, klocktid) → temperatur, tryck, vind\n'}
            {'  ρ ur temperatur + tryck (lufttäthet)\n'}
            {'  vinden skalas till 1,2 m via z0 (terrängexponering)\n'}
            {'  vind → motvind + sidvind mot segmentets kurs\n'}
            {'  bisektion: fart v så att rider-NP(v) = mål-NP (tolerans 0,1 W)\n'}
            {'  effekttak appliceras · tid = längd ÷ v ackumuleras'}
          </div>
          <p>
            Effekttak: hårt tak 1,3 × FTP per drag (ett 45 s-drag är en kort ansträngning över
            tröskeln, hållbarheten begränsas av NP, inte av enskilda drag), mjukt tak 0,92 × FTP i
            backar brantare än 3 %, och ett planeringstak på 50 km/h: i stark medvind eller utför är
            extra fart buffert, inte bankad tid. Första kilometern är neutral: 20 km/h utanför
            NP-modellen.
          </p>
          <p>
            Yttre lösaren bisekterar mål-NP i intervallet [60, FTP] W, max 45 iterationer, tills
            totaltiden träffar måltiden inom ±20 s. Går det inte ens på FTP flaggas planen som
            onåbar och den snabbaste hållbara planen returneras. Om hela åkets NP överstiger 0,75 ×
            FTP varnar planen (intensitetsfaktor).
          </p>
        </DeepDive>
      </Section>

      <Section title="Tre vindscenarier" figure={<ScenarioFigure />}>
        <p>
          Väder är osäkert, så vi räknar tre gånger: med lugnare vind än väntat (optimistiskt), med
          väntad vind, och med kraftigare vind (pessimistiskt). Då ser du hur mycket sluttiden kan
          skilja åt båda håll i stället för att lita på en enda siffra.
        </p>
        <DeepDive>
          <p>
            Vädret hämtas som en ensemble från SMHI, MET Norway och Open-Meteo (inklusive de
            enskilda ensemblemedlemmarna) och aggregeras till celler i rum och tid med skalär
            medelvind, vektormedel för riktning och percentilspridning (p10 / p90) över källor och
            medlemmar.
          </p>
          <div className="howto-formula howto-formula-block">
            {'förväntat      = medelvind\n'}
            {'optimistiskt   = p10 (mindre vind)\n'}
            {'pessimistiskt  = p90 (mer vind)'}
          </div>
          <p>
            Är rutten netto i medvind (ruttens riktning projicerad på medelvindriktningen)
            inverteras mappningen, då är mer vind snabbare, så pessimistiskt = p10. Alla tre
            scenarier löses mot samma måltid och skiljer sig i vilken mål-NP (ansträngningsnivå) som
            krävs. Tidsspannet räknas ärligt: förväntad NP hålls fast och rutten marscheras om under
            p10- respektive p90-vind, vilket ger min/max på sluttiden.
          </p>
        </DeepDive>
      </Section>

      <Section title="Från rutt till tempokort" figure={<SegmentFigure />}>
        <p>
          Rutten körs i två upplösningar. Fysiken marscherar hundratals små mikrosegment, ett per
          GPX-punkt, så lutning och vind blir exakta. Men ett kort på styret behöver bara en
          handfull rader, så vi grupperar mikrosegmenten till visningssegment och klipper en ny rad
          där något verkligt ändras: vid en kontroll eller depå, där vägen växlar mellan flackt och
          backe (lutningen korsar 3 %), och där vinden vänder från mot till med. På den inlästa
          rutten kommer kontrollerna från dina depåstopp, plus start och mål.
        </p>
        <p>
          Sedan städar vi: korta stumpar slås ihop med den granne som har närmast effekt, rader med
          nästan samma lutning slås ihop, och totalen kapas så att kortet förblir läsbart. Orter och
          depåer slås aldrig bort. Varje rad får ett nyckelord, JÄMN FART, KLÄTTRING, SISTA UPPFÖR,
          BACKAR, TA DET LUGNT eller ÖKA, och Not-kolumnen visas bara när rutten faktiskt har något
          att säga, alltså inte på platta, vindstilla varv. Styrkortsläget klipper bara på
          kontroller och stopp för ett rent kort; fullständig vy lägger till lutnings- och
          vindgränserna.
        </p>
        <DeepDive>
          <p>Gränserna byggs ur mikrosegmenten, snäpps till närmaste segmentslut och grupperas:</p>
          <div className="howto-formula howto-formula-block">
            {'gräns = kontroll/depå | lutning korsar 3 % | vind vänder (>1 m/s) | start/mål\n'}
            {'slå ihop rader kortare än 2 km → granne med närmast snitt-effekt\n'}
            {'slå ihop rader med lutningsskillnad < 0,3 %  (samma nyckelord)\n'}
            {'kapa till ≤ 50 rader (styrkortsläge ≤ 20)'}
          </div>
          <p>
            All aggregering (fart, effekt, vind) är tidsviktad, eftersom mikrosegmentens längd
            följer GPX-punkternas täthet. En efterpass märker den sista klättringen före mål som
            SISTA UPPFÖR. Depå- och ortgränser korsas aldrig vid sammanslagning, så markörerna står
            kvar.
          </p>
        </DeepDive>
      </Section>

      <Section title="Ankomst, depå och avgång" figure={<EtaClockFigure />}>
        <p>
          När farten är känd på varje sträcka kan vi sätta en klocka på kortet. Varje rads slut får
          en klocktid: starttiden plus all restid dit. Vid en depå lägger vi på dina stoppminuter,
          så kortet visar både ankomst och avgång, och alla tider efter depån skjuts fram lika
          mycket. Sluttiden är summan av rulltid och stopptid, så längre depåstopp syns direkt i
          måltiden.
        </p>
        <Formula caption="Depåtiden är inte bortkastad, den ligger inbakad i varje klockslag efter stoppet.">
          ankomst = starttid + restid dit · avgång = ankomst + depåminuter
        </Formula>
        <DeepDive>
          <p>Varje segment bär sekunder-från-start vid sitt slut; depåer lägger till stopptid:</p>
          <div className="howto-formula howto-formula-block">
            {'eta_s = sekunder från start vid segmentets slut\n'}
            {'avgång_s = eta_s + depåminuter × 60\n'}
            {'klockslag = (starttid + eta_s) mod 24 h   (slår runt midnatt)\n'}
            {'total tid = rulltid + stopptid'}
          </div>
          <p>
            Klockan visas som lokal tid och hanterar varv som passerar midnatt. Depåstopp är hårda
            gränser i kortet: de slås aldrig ihop med grannrader, så ankomst- och avgångstiden står
            alltid kvar på sin egen rad.
          </p>
        </DeepDive>
      </Section>

      <footer className="howto-footer">
        <p>
          <strong>Du matar in:</strong> rutt (GPX), din FTP, antal i gruppen, måltid, depåstopp och
          väder. <strong>Du får ut:</strong> tempokort, depåtider och filer till klocka och Garmin.
        </p>
        <p>Allt räknas i din webbläsare, inga uppgifter sparas eller skickas vidare.</p>
        <p className="howto-links">
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Öppen källkod på GitHub
          </a>
          <button type="button" className="link" onClick={onBack}>
            ← Tillbaka till kalkylatorn
          </button>
        </p>
      </footer>
    </div>
  );
}
