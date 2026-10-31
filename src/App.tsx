import { useEffect, useMemo, useState } from "react";
import { MetalBadge, MetalButton, MetalCard } from "argentui";
import { Clapperboard, Film, Search, Sparkles, Tv } from "lucide-react";
import { CATALOG, CATEGORY_LABEL, countByCategory, dailyPicks, findTitle, searchTitles, type Category, type Title } from "./lib/catalog";
import { LANG_LABEL } from "./lib/moviez";
import Hero from "./components/Hero";
import PosterCard from "./components/PosterCard";
import PlayerModal, { type PlaySubject } from "./components/PlayerModal";
import DirectLookup from "./components/DirectLookup";

type Filter = Category | "all";
type LangFilter = "all" | "vf" | "vostfr" | "vo" | "multi";

const FILTERS: Filter[] = ["all", "film", "serie", "anime"];
const LANGS: LangFilter[] = ["all", "vf", "vostfr", "vo", "multi"];

function subjectOf(item: Title): PlaySubject {
  return { id: item.id, type: item.type, title: item.title, seasons: item.seasons, languages: item.languages };
}

function useHashSubject(): PlaySubject | null {
  const [subject, setSubject] = useState<PlaySubject | null>(null);

  useEffect(() => {
    const apply = () => {
      const match = /^#\/t\/(\d+)/.exec(window.location.hash);
      if (!match) {
        setSubject(null);
        return;
      }
      const item = findTitle(Number(match[1]));
      if (item) setSubject(subjectOf(item));
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  return subject;
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const onChange = () => setNarrow(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export default function App() {
  const [filter, setFilter] = useState<Filter>("all");
  const [lang, setLang] = useState<LangFilter>("all");
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState<PlaySubject | null>(null);
  const routeSubject = useHashSubject();
  const narrow = useIsNarrow();

  const featured = useMemo(() => dailyPicks(1)[0] ?? CATALOG[0], []);
  const open = manual ?? routeSubject;

  const items = useMemo(() => {
    let list = CATALOG;
    if (filter !== "all") list = list.filter((item) => item.category === filter);
    if (lang !== "all") list = list.filter((item) => item.languages.includes(lang));
    return searchTitles(query, list);
  }, [filter, lang, query]);

  const rails = useMemo(
    () =>
      (["film", "serie", "anime"] as Category[]).map((category) => ({
        category,
        items: items.filter((item) => item.category === category).slice(0, 18),
      })),
    [items],
  );

  const searchMode = query.trim().length > 0 || filter !== "all" || lang !== "all";
  const numeric = /^\d+$/.test(query.trim());
  const numericHit = numeric ? findTitle(Number(query.trim())) : undefined;

  const play = (item: Title) => {
    window.location.hash = `/t/${item.id}`;
  };

  const closePlayer = () => {
    setManual(null);
    if (window.location.hash.startsWith("#/t/")) {
      history.pushState("", document.title, `${window.location.pathname}${window.location.search}`);
    }
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  };

  return (
    <div className="mf-shell">
      <header className="mf-header">
        <a className="mf-logo" href="#/" aria-label="MetalFlix, retour en haut">
          <Clapperboard size={18} strokeWidth={2.2} />
          <span>
            METAL<strong>FLIX</strong>
          </span>
        </a>

        <div className="mf-header__search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un film, une série, un id TMDB…"
            aria-label="Rechercher dans le catalogue"
          />
          {query ? (
            <button type="button" className="mf-clear" onClick={() => setQuery("")} aria-label="Effacer la recherche">
              ×
            </button>
          ) : null}
        </div>

        <nav className="mf-header__meta" aria-label="Catalogue">
          <MetalBadge tone="silver">{countByCategory("film")} films</MetalBadge>
          <MetalBadge tone="cobalt">{countByCategory("serie")} séries</MetalBadge>
          <MetalBadge tone="amethyst">{countByCategory("anime")} animes</MetalBadge>
        </nav>
      </header>

      <main>
        <Hero item={featured} onPlay={play} titleSize={narrow ? 52 : 92} />

        <section className="mf-toolbar" aria-label="Filtres">
          <div className="mf-seg" role="tablist" aria-label="Catégories">
            {FILTERS.map((value) => (
              <MetalButton
                key={value}
                role="tab"
                aria-selected={filter === value}
                tone={filter === value ? "gold" : "gunmetal"}
                variant={filter === value ? "fill" : "border"}
                size="sm"
                radius={999}
                onClick={() => setFilter(value)}
              >
                {CATEGORY_LABEL[value]}
              </MetalButton>
            ))}
          </div>

          <div className="mf-seg mf-seg--langs" role="group" aria-label="Langues disponibles">
            {LANGS.map((value) => (
              <button
                key={value}
                type="button"
                className={`mf-chip mf-chip--button${lang === value ? " is-active" : ""}`}
                onClick={() => setLang(value)}
              >
                {value === "all" ? "Toutes langues" : LANG_LABEL[value]}
              </button>
            ))}
          </div>

          <p className="mf-count">
            {items.length} titre{items.length > 1 ? "s" : ""}
            {lang !== "all" ? ` en ${LANG_LABEL[lang]}` : ""}
          </p>
        </section>

        {numeric && !numericHit ? (
          <section className="mf-section">
            <DirectLookup id={Number(query.trim())} onPlay={(subject) => setManual(subject)} />
          </section>
        ) : null}

        {items.length === 0 && !numeric ? (
          <MetalCard tone="gunmetal" radius={18} className="mf-empty">
            <h3>Aucun titre ne correspond</h3>
            <p>Essayez un autre mot-clé, ou collez un id TMDB pour ouvrir le lecteur directement.</p>
          </MetalCard>
        ) : null}

        {searchMode
          ? items.length > 0 && (
              <section className="mf-section" aria-label="Résultats">
                <div className="mf-section__head">
                  <h2>{query.trim() ? "Résultats" : CATEGORY_LABEL[filter]}</h2>
                  <span>{items.length}</span>
                </div>
                <div className="mf-grid">
                  {items.map((item) => (
                    <PosterCard key={item.id} item={item} onOpen={play} />
                  ))}
                </div>
              </section>
            )
          : rails.map(
              (rail) =>
                rail.items.length > 0 && (
                  <section className="mf-section" key={rail.category} aria-label={CATEGORY_LABEL[rail.category]}>
                    <div className="mf-section__head">
                      <h2>
                        {rail.category === "film" ? <Film size={16} /> : rail.category === "serie" ? <Tv size={16} /> : <Sparkles size={16} />}
                        {CATEGORY_LABEL[rail.category]}
                      </h2>
                      <button type="button" className="mf-more" onClick={() => setFilter(rail.category)}>
                        Tout voir →
                      </button>
                    </div>
                    <div className="mf-rail">
                      {rail.items.map((item) => (
                        <PosterCard key={item.id} item={item} onOpen={play} />
                      ))}
                    </div>
                  </section>
                ),
            )}

        <footer className="mf-footer">
          <p>
            Catalogue et lecteur : <a href="https://api.moviez.ac/">Moviez API</a> — affiches et métadonnées TMDB. Aucune
            clé requise : <code>/api/check/&lt;id&gt;</code> suffit.
          </p>
          <p>
            Habillage <a href="https://github.com/seangeng/argent">Argent</a> (métal liquide, MIT). Site statique servi par
            GitHub Pages.
          </p>
        </footer>
      </main>

      {open ? <PlayerModal subject={open} onClose={closePlayer} /> : null}
    </div>
  );
}
