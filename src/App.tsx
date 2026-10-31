import { useEffect, useMemo, useState } from "react";
import { Clapperboard, Film, LogIn, Search, Sparkles, Tv } from "lucide-react";
import {
  CATEGORY_LABEL,
  GENRE_LABEL,
  GENRE_ORDER,
  PAGE_SIZE,
  countByCategory,
  dailyPicks,
  decadesOf,
  findTitle,
  loadCatalog,
  searchTitles,
  type Category,
  type GenreKey,
  type Title,
} from "./lib/catalog";
import { currentProfileId, listProfiles, signOut, type Profile } from "./lib/accounts";
import {
  EMPTY_LIBRARY,
  clearHistory,
  markDone,
  readLibrary,
  recordWatch,
  removeHistory,
  snapshotOf,
  toggleWatchlist,
  type Library,
  type LibraryItem,
} from "./lib/library";
import Hero from "./components/Hero";
import PosterCard from "./components/PosterCard";
import PlayerModal, { type PlaySubject } from "./components/PlayerModal";
import DirectLookup from "./components/DirectLookup";
import AccountModal from "./components/AccountModal";
import AccountPage from "./components/AccountPage";

type Filter = Category | "all";
type Sort = "default" | "recent" | "oldest";
type Route = { name: "home" } | { name: "account" } | { name: "title"; id: number };

const FILTERS: Filter[] = ["all", "film", "serie", "anime"];
const SORT_LABEL: Record<Sort, string> = {
  default: "Pertinence",
  recent: "Année ↓",
  oldest: "Année ↑",
};

function parseHash(): Route {
  const hash = window.location.hash;
  const match = /^#\/t\/(\d+)/.exec(hash);
  if (match) return { name: "title", id: Number(match[1]) };
  if (hash.startsWith("#/compte")) return { name: "account" };
  return { name: "home" };
}

function subjectFor(catalog: Title[], id: number): PlaySubject | null {
  const item = findTitle(catalog, id);
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    poster: item.poster,
    year: item.year,
    category: item.category,
  };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [filter, setFilter] = useState<Filter>("all");
  const [genre, setGenre] = useState<GenreKey | "all">("all");
  const [decade, setDecade] = useState<number | "all">("all");
  const [sort, setSort] = useState<Sort>("default");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [manual, setManual] = useState<PlaySubject | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(() => {
    const id = currentProfileId();
    return id ? listProfiles().find((p) => p.id === id) ?? null : null;
  });
  const [library, setLibrary] = useState<Library>(() => (profile ? readLibrary(profile.id) : EMPTY_LIBRARY));
  const [catalog, setCatalog] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);

  const featured = useMemo(() => (catalog.length ? dailyPicks(catalog, 6) : []), [catalog]);
  const decades = useMemo(() => decadesOf(catalog), [catalog]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    loadCatalog().then((items) => {
      if (!alive) return;
      setCatalog(items);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setVisible(PAGE_SIZE), [filter, genre, decade, sort, query]);

  const wantedIds = useMemo(() => new Set(library.watchlist.map((item) => item.id)), [library.watchlist]);

  const filtered = useMemo(
    () =>
      catalog.filter(
        (item) =>
          (filter === "all" || item.category === filter) &&
          (genre === "all" || item.genres.includes(genre)) &&
          (decade === "all" || (item.year ? Math.floor(item.year / 10) * 10 === decade : false)),
      ),
    [catalog, filter, genre, decade],
  );

  const results = useMemo(() => {
    const list = searchTitles(query, filtered);
    if (sort === "recent") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "oldest") return [...list].sort((a, b) => a.year - b.year);
    return list;
  }, [filtered, query, sort]);

  const searchMode = query.trim().length > 0 || filter !== "all" || genre !== "all" || decade !== "all" || sort !== "default";
  const numeric = /^\d+$/.test(query.trim());
  const numericHit = numeric ? findTitle(catalog, Number(query.trim())) : undefined;

  const routeSubject = route.name === "title" ? subjectFor(catalog, route.id) : null;
  const openSubject = manual ?? routeSubject;
  const openDone = openSubject ? library.history.find((item) => item.id === openSubject.id)?.done ?? false : false;

  const rails = useMemo(
    () =>
      (["film", "serie", "anime"] as Category[]).map((category) => ({
        category,
        items: catalog.filter((item) => item.category === category).slice(0, 18),
      })),
    [catalog],
  );

  function openTitle(item: Title) {
    window.location.hash = `/t/${item.id}`;
  }

  function closePlayer() {
    setManual(null);
    history.pushState("", document.title, `${window.location.pathname}${window.location.search}`);
    setRoute(parseHash());
  }

  function toggleWatch(snapshot: Omit<LibraryItem, "at">) {
    if (!profile) {
      setAuthOpen(true);
      return;
    }
    setLibrary(toggleWatchlist(profile.id, snapshot));
  }

  function onWatched(subject: PlaySubject, season: number, episode: number) {
    if (!profile) return;
    setLibrary(
      recordWatch(profile.id, {
        id: subject.id,
        title: subject.title,
        poster: subject.poster ?? null,
        year: subject.year ?? null,
        type: subject.type,
        category: subject.category ?? (subject.type === "movie" ? "film" : "serie"),
        ...(subject.type === "series" ? { season, episode } : {}),
      }),
    );
  }

  function toggleDone(id: number) {
    if (!profile) return;
    const current = library.history.find((item) => item.id === id)?.done ?? false;
    setLibrary(markDone(profile.id, id, !current));
  }

  function openLibraryItem(item: LibraryItem) {
    const title = findTitle(catalog, item.id);
    if (title) {
      openTitle(title);
      return;
    }
    setManual({
      id: item.id,
      type: item.type,
      title: item.title,
      poster: item.poster ?? undefined,
      year: item.year,
      category: item.category,
    });
  }

  function handleAuthenticated(next: Profile) {
    setProfile(next);
    setLibrary(readLibrary(next.id));
    setAuthOpen(false);
  }

  function handleSignOut() {
    signOut();
    setProfile(null);
    setLibrary(EMPTY_LIBRARY);
  }

  function exportLibrary() {
    const payload = { profile: profile?.name, exportedAt: new Date().toISOString(), ...library };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `metalflix-${(profile?.name ?? "profil").toLowerCase().replace(/\s+/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    setFilter("all");
    setGenre("all");
    setDecade("all");
    setSort("default");
    setQuery("");
  }

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
            placeholder={`Rechercher parmi ${catalog.length.toLocaleString("fr-FR")} titres…`}
            aria-label="Rechercher dans le catalogue"
          />
          {query ? (
            <button type="button" className="mf-clear" onClick={() => setQuery("")} aria-label="Effacer la recherche">
              ×
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="mf-account-btn"
          onClick={() => (profile ? (window.location.hash = "/compte") : setAuthOpen(true))}
        >
          {profile ? (
            <>
              <span className="mf-account-btn__avatar">{profile.name.slice(0, 1).toUpperCase()}</span>
              {profile.name}
            </>
          ) : (
            <>
              <LogIn size={15} /> Compte
            </>
          )}
        </button>
      </header>

      <main>
        {loading ? (
          <section className="mf-loading" aria-live="polite">
            <p>Chargement du catalogue…</p>
          </section>
        ) : route.name === "account" ? (
          <AccountPage
            profile={profile}
            library={library}
            onOpenTitle={openLibraryItem}
            onToggleWatch={(item) => toggleWatch(item)}
            onToggleDone={toggleDone}
            onRemoveHistory={(id) => profile && setLibrary(removeHistory(profile.id, id))}
            onClearHistory={() => profile && setLibrary(clearHistory(profile.id))}
            onExport={exportLibrary}
            onSignOut={handleSignOut}
            onConnect={() => setAuthOpen(true)}
          />
        ) : (
          <>
            <Hero items={featured} onPlay={openTitle} />

            <section className="mf-toolbar" aria-label="Filtres">
              <div className="mf-seg" role="tablist" aria-label="Catégories">
                {FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    className={`mf-seg__btn${filter === value ? " is-active" : ""}`}
                    onClick={() => setFilter(value)}
                  >
                    {CATEGORY_LABEL[value]}
                  </button>
                ))}
              </div>

              <div className="mf-filters">
                <label className="mf-select">
                  <span>Genre</span>
                  <select value={genre} onChange={(event) => setGenre(event.target.value as GenreKey | "all")}>
                    <option value="all">Tous</option>
                    {GENRE_ORDER.map((key) => (
                      <option key={key} value={key}>
                        {GENRE_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mf-select">
                  <span>Année</span>
                  <select
                    value={String(decade)}
                    onChange={(event) => setDecade(event.target.value === "all" ? "all" : Number(event.target.value))}
                  >
                    <option value="all">Toutes</option>
                    {decades.map((value) => (
                      <option key={value} value={value}>
                        {value}s
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mf-select">
                  <span>Tri</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                    {(Object.keys(SORT_LABEL) as Sort[]).map((value) => (
                      <option key={value} value={value}>
                        {SORT_LABEL[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="mf-btn mf-btn--sm" onClick={resetFilters}>
                  Réinitialiser
                </button>
              </div>

              <p className="mf-count">
                {results.length.toLocaleString("fr-FR")} titre{results.length > 1 ? "s" : ""}
              </p>
            </section>

            {numeric && !numericHit ? (
              <section className="mf-section">
                <DirectLookup id={Number(query.trim())} onPlay={(subject) => setManual(subject)} />
              </section>
            ) : null}

            {results.length === 0 && !numeric ? (
              <section className="mf-section">
                <div className="mf-panel mf-empty">
                  <h3>Aucun titre ne correspond</h3>
                  <p>Essayez un autre mot-clé, un autre genre, ou collez un id TMDB pour ouvrir le lecteur directement.</p>
                </div>
              </section>
            ) : null}

            {searchMode ? (
              results.length > 0 && (
                <section className="mf-section" aria-label="Résultats">
                  <div className="mf-section__head">
                    <h2>{query.trim() ? "Résultats" : CATEGORY_LABEL[filter]}</h2>
                    <span>{results.length}</span>
                  </div>
                  <div className="mf-grid">
                    {results.slice(0, visible).map((item) => (
                      <PosterCard
                        key={item.id}
                        item={item}
                        onOpen={openTitle}
                        wanted={wantedIds.has(item.id)}
                        onToggleWatch={(title) => toggleWatch(snapshotOf(title))}
                      />
                    ))}
                  </div>
                  {visible < results.length ? (
                    <div className="mf-loadmore">
                      <button
                        type="button"
                        className="mf-btn"
                        onClick={() => setVisible((value) => value + PAGE_SIZE * 2)}
                      >
                        Charger {Math.min(PAGE_SIZE * 2, results.length - visible)} titres de plus
                      </button>
                    </div>
                  ) : null}
                </section>
              )
            ) : (
              rails.map(
                (rail) =>
                  rail.items.length > 0 && (
                    <section className="mf-section" key={rail.category} aria-label={CATEGORY_LABEL[rail.category]}>
                      <div className="mf-section__head">
                        <h2>
                          {rail.category === "film" ? (
                            <Film size={16} />
                          ) : rail.category === "serie" ? (
                            <Tv size={16} />
                          ) : (
                            <Sparkles size={16} />
                          )}
                          {CATEGORY_LABEL[rail.category]}
                          <span className="mf-section__total">{countByCategory(catalog, rail.category)}</span>
                        </h2>
                        <button type="button" className="mf-more" onClick={() => setFilter(rail.category)}>
                          Tout voir →
                        </button>
                      </div>
                      <div className="mf-rail">
                        {rail.items.map((item) => (
                          <PosterCard
                            key={item.id}
                            item={item}
                            onOpen={openTitle}
                            wanted={wantedIds.has(item.id)}
                            onToggleWatch={(title) => toggleWatch(snapshotOf(title))}
                          />
                        ))}
                      </div>
                    </section>
                  ),
              )
            )}
          </>
        )}

        <footer className="mf-footer">
          <p>
            Catalogue et lecteur : <a href="https://api.moviez.ac/">Moviez API</a> — {catalog.length.toLocaleString("fr-FR")}{" "}
            titres réellement servis par l'API, affiches TMDB. Aucune clé requise : <code>/api/check/&lt;id&gt;</code> suffit.
          </p>
          <p>
            Comptes, historique et watch list sont stockés dans ce navigateur — site statique servi par GitHub Pages.
            Genres issus de Wikidata.
          </p>
        </footer>
      </main>

      {openSubject ? (
        <PlayerModal
          subject={openSubject}
          onClose={closePlayer}
          wanted={wantedIds.has(openSubject.id)}
          done={openDone}
          onToggleDone={() => toggleDone(openSubject.id)}
          onToggleWatch={(subject) =>
            toggleWatch({
              id: subject.id,
              title: subject.title,
              poster: subject.poster ?? null,
              year: subject.year ?? null,
              type: subject.type,
              category: subject.category ?? (subject.type === "movie" ? "film" : "serie"),
            })
          }
          onWatched={onWatched}
        />
      ) : null}

      {authOpen ? <AccountModal onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} /> : null}
    </div>
  );
}
