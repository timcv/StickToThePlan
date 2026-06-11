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
        bakom ligger i lä med ungefär en femtedel lägre luftmotstånd.
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
        I lä: ungefär 20 % lägre luftmotstånd
      </text>
    </svg>
  );
}

function SolverFigure() {
  const steps = [
    { x: 30, label: 'Gissa', sub: 'ansträngning' },
    { x: 198, label: 'Marschera', sub: 'rutten sträcka för sträcka' },
    { x: 366, label: 'Summera', sub: 'total tid' },
    { x: 534, label: 'Träffar', sub: 'måltiden?' },
  ];
  return (
    <svg width="100%" viewBox="0 0 680 168" role="img" aria-labelledby="fig5-t fig5-d">
      <title id="fig5-t">Lösarens slinga</title>
      <desc id="fig5-d">
        Fyra steg i rad: gissa en ansträngning, marschera rutten, summera tiden och se om den
        träffar målet. En pil tillbaka visar att ansträngningen justeras och slingan körs om tills
        tiden stämmer.
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
        Justera ansträngningen och kör om tills tiden stämmer på sekunden
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

      <Section title="Tre krafter du trampar mot" figure={<ForcesFigure />}>
        <p>
          Varje sekund räknar vi hur många watt som krävs för att övervinna tre motstånd: tyngden i
          backen, däcken mot asfalten och luften framför dig. Luftmotståndet är i särklass störst på
          platt mark.
        </p>
        <Formula caption="Luftmotståndet växer med farten i kvadrat, därför betyder vind och kroppshållning så mycket.">
          effekt = (backe + rull + luft) × fart ÷ verkningsgrad
        </Formula>
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
      </Section>

      <Section title="I grupp: drafting och jämn ansträngning" figure={<PacelineFigure />}>
        <p>
          I ett kedjegäng ligger du mest i lä, där luftmotståndet är ungefär en femtedel lägre. Vi
          modellerar rotationen: korta, hårda drag på täten och längre återhämtning i hjul. För att
          fånga vad det gör med kroppen mäter vi din ansträngning som normaliserad effekt (NP), ett
          mått som straffar de hårda dragen hårdare än ett vanligt snitt gör.
        </p>
        <Formula caption="Upphöjt till fyra gör att korta hårda drag väger tyngre, precis som de känns i benen.">
          NP = (medel av 30-sekunders rullande effekt⁴)^¼
        </Formula>
      </Section>

      <Section title="Hur lösaren hittar din tid" figure={<SolverFigure />}>
        <p>
          Vi gissar en ansträngningsnivå, kör igenom hela rutten sträcka för sträcka, räknar fart
          och tid på varje, och summerar. Blev det för långsamt höjer vi ansträngningen, för snabbt
          sänker vi den, och halverar intervallet tills tiden stämmer med ditt mål. Realistiska
          effekttak gör att planen aldrig kräver orimligt hårda drag i branta backar eller farter
          över 50 km/h.
        </p>
      </Section>

      <Section title="Tre vindscenarier" figure={<ScenarioFigure />}>
        <p>
          Väder är osäkert, så vi räknar tre gånger: med lugnare vind än väntat (optimistiskt), med
          väntad vind, och med kraftigare vind (pessimistiskt). Då ser du hur mycket sluttiden kan
          skilja åt båda håll i stället för att lita på en enda siffra.
        </p>
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
