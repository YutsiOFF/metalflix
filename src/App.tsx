import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Clapperboard, Film, Flame, LogIn, Menu, Search, Sparkles, Tv, X } from "lucide-react";
import {
  CATEGORY_LABEL,
  GENRE_LABEL,
  GENRE_ORDER,
  PAGE_SIZE,
  PLATFORM_LABEL,
  PLATFORM_ORDER,
  countByCategory,
  findTitle,
  loadCatalog,
  loadFreshAdditions,
  loadRestCatalog,
  mergeTitles,
  heroPicks,
  ratedTop,
  seriesTop,
  searchTitles,
  yearsOf,
  type Category,
  type GenreKey,
  type PlatformKey,
  type Title,
} from "./lib/catalog";
import { currentProfileId, listProfiles, signOut, type Profile } from "./lib/accounts";
import {
  clearHistory,
  markDone,
  LOCAL_PROFILE_ID,
  readLibrary,
  recordProgress,
  recordWatch,
  removeHistory,
  snapshotOf,
  toggleWatchlist,
  type HistoryEntry,
  type Library,
  type LibraryItem,
} from "./lib/library";
import Dropdown from "./components/Dropdown";
import Hero from "./components/Hero";
import ResumeRail from "./components/ResumeRail";
import StudioRail from "./components/StudioRail";
import TopRail from "./components/TopRail";
import Rail from "./components/Rail";
import PosterCard from "./components/PosterCard";
import PlayerModal, { type PlaySubject } from "./components/PlayerModal";
import DirectLookup from "./components/DirectLookup";
import AccountModal from "./components/AccountModal";
import AccountPage from "./components/AccountPage";
import InstallButton from "./components/InstallButton";
import UpdateNotice from "./components/UpdateNotice";

type Filter = Category | "all" | "nouveaute";
type Sort = "default" | "recent" | "oldest";
type Route = { name: "home" } | { name: "account" } | { name: "title"; id: number };

const FILTERS: Filter[] = ["all", "film", "serie", "anime", "nouveaute"];
const FILTER_LABEL: Record<Filter, string> = { ...CATEGORY_LABEL, nouveaute: "Nouveautés" };
/** Genres worth their own row on the home page, most browsed first. */
const GENRE_ROWS: GenreKey[] = ["horror", "action", "comedy", "scifi", "thriller", "drama", "animation", "romance"];
/** "Nouveautés" only lists what actually came out: this year and the last one. */
const CURRENT_YEAR = new Date().getFullYear();
const NEW_SINCE = CURRENT_YEAR - 1;
const TODAY = new Date().toISOString().slice(0, 10);

/**
 * Already out, with a date we could check. A title the API added after the
 * build (`fresh`) carries the year the API announced, and a film that was only
 * announced carries one that does not exist yet: neither may reach a row.
 */
function isReleased(item: Title): boolean {
  if (item.pending || item.fresh) return false;
  if (item.date) return item.date <= TODAY;
  return item.year > 0 && item.year <= CURRENT_YEAR;
}

/** Released and with a poster: the pool rows draw from. */
function posterPool(list: Title[]): Title[] {
  return list.filter((item) => item.poster && isReleased(item));
}

/** Newest first, capped at one row. */
function freshTitles(list: Title[], limit = 40): Title[] {
  return list
    .filter((item) => isReleased(item) && item.year >= NEW_SINCE && item.year <= CURRENT_YEAR)
    .sort((a, b) => b.year - a.year)
    .slice(0, limit);
}
const SORT_LABEL: Record<Sort, string> = {
  default: "Pertinence",
  recent: "Année ↓",
  oldest: "Année ↑",
};

interface HomeRow {
  key: string;
  head: string;
  icon?: ReactNode;
  items: Title[];
  total?: number;
  large?: boolean;
  onSeeAll?: () => void;
}

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
    genres: item.genres,
    source: item.source,
    slug: item.slug,
  };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [filter, setFilter] = useState<Filter>("all");
  const [genre, setGenre] = useState<GenreKey | "all">("all");
  const [year, setYear] = useState<number | "all">("all");
  const [platform, setPlatform] = useState<PlatformKey | "all">("all");
  const scrollToResults = useRef(false);
  const [sort, setSort] = useState<Sort>("default");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [manual, setManual] = useState<PlaySubject | null>(null);
  const [resume, setResume] = useState<{
    id: number;
    season: number;
    episode: number;
    /** 0–1, the position the viewer had reached in that episode. */
    progress?: number;
  } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  // Only the phone layout reads this: there the filters and the account live
  // behind a button instead of sharing the header row.
  const [navOpen, setNavOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(() => {
    const id = currentProfileId();
    return id ? listProfiles().find((p) => p.id === id) ?? null : null;
  });
  // Signed-out viewers still get history and the resume rail, under a local id.
  const libId = profile?.id ?? LOCAL_PROFILE_ID;
  const [library, setLibrary] = useState<Library>(() => readLibrary(profile ? profile.id : LOCAL_PROFILE_ID));
  const progressRef = useRef({ key: "", ratio: -1 });
  const [catalog, setCatalog] = useState<Title[]>([]);
  const [loading, setLoading] = useState(true);

  // The hero: five of the best recent films, drawn again at every visit and,
  // for a tab left open, every five hours.
  const [heroDraw, setHeroDraw] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setHeroDraw((value) => value + 1), 5 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  // Drawn once the catalogue is there, not again when its second chunk lands:
  // the banner must not swap films under the viewer's eyes.
  const [featured, setFeatured] = useState<Title[]>([]);
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;
  const hasCatalog = catalog.length > 0;
  useEffect(() => {
    if (hasCatalog) setFeatured(heroPicks(catalogRef.current, 5));
  }, [hasCatalog, heroDraw]);
  // « Top 10 des films aujourd'hui » : les films sortis récemment, classés par
  // note TMDB (scripts/top-rated.mjs) et limités à ce que le catalogue peut lire.
  const topFilms = useMemo(() => (catalog.length ? ratedTop(catalog, 10) : []), [catalog]);
  // « Top 10 des séries aujourd'hui », placed right after the new-release rows.
  const topSeries = useMemo(() => (catalog.length ? seriesTop(catalog, 10) : []), [catalog]);

  const genreOptions = useMemo(() => {
    const counts = new Map<GenreKey, number>();
    for (const item of catalog) for (const key of item.genres) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [
      { value: "all", label: "Tous les genres", compact: "Genre", count: catalog.length },
      ...GENRE_ORDER.map((key) => ({ value: key, label: GENRE_LABEL[key], count: counts.get(key) ?? 0 })),
    ];
  }, [catalog]);

  const yearOptions = useMemo(
    () => [
      { value: "all", label: "Toutes les années", compact: "Année", count: catalog.length },
      ...yearsOf(catalog).map(({ year: value, count }) => ({ value: String(value), label: String(value), count })),
    ],
    [catalog],
  );

  const sortOptions = useMemo(
    () =>
      (Object.keys(SORT_LABEL) as Sort[]).map((value) => ({
        value,
        label: SORT_LABEL[value],
        // The header hides the field names on phones, so the closed button says
        // what it sorts rather than repeating the current value alone.
        compact: value === "default" ? "Pertinence" : SORT_LABEL[value],
      })),
    [],
  );

  // Only the services actually carrying something are offered: an empty
  // platform would just add a row that always lands on "aucun résultat".
  const platformOptions = useMemo(() => {
    const counts = new Map<PlatformKey, number>();
    for (const item of catalog) for (const key of item.platforms) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [
      { value: "all", label: "Toutes les plateformes", compact: "Plateforme" },
      ...PLATFORM_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => ({
        value: key,
        label: PLATFORM_LABEL[key],
        count: counts.get(key) ?? 0,
      })),
    ];
  }, [catalog]);

  /** The platform tiles only show services that carry at least one title. */
  const studioCounts = useMemo(() => {
    const counts = new Map<PlatformKey, number>();
    for (const item of catalog) for (const key of item.platforms) counts.set(key, (counts.get(key) ?? 0) + 1);
    return PLATFORM_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => ({
      key,
      label: PLATFORM_LABEL[key],
      count: counts.get(key) ?? 0,
    }));
  }, [catalog]);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // The drawer must not stay open behind a new page, a wider window or Escape.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    const wide = window.matchMedia("(min-width: 901px)");
    const onWide = () => {
      if (wide.matches) setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [navOpen]);

  useEffect(() => setNavOpen(false), [route]);

  useEffect(() => {
    let alive = true;
    loadCatalog().then((items) => {
      if (!alive) return;
      setCatalog(items);
      setLoading(false);
      // The rest of the catalogue follows in a second chunk: counts, search and
      // pagination widen once it lands, without holding up the first paint.
      loadRestCatalog((all) => {
        if (alive) setCatalog(all);
      });
      // The build is a snapshot: ask the API what it gained since, so a title
      // added today reaches the hero and the "Nouveautés" rows by itself.
      loadFreshAdditions().then((added) => {
        if (alive && added.length) setCatalog((all) => mergeTitles(all, added));
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => setVisible(PAGE_SIZE), [filter, genre, platform, year, sort, query]);

  const wantedIds = useMemo(() => new Set(library.watchlist.map((item) => item.id)), [library.watchlist]);

  /** Started but not finished, newest first — what "reprendre" means here. */
  const resumable = useMemo(
    () => library.history.filter((item) => !item.done && (item.progress ?? 0) < 0.95).slice(0, 12),
    [library.history],
  );

  const filtered = useMemo(
    () =>
      catalog.filter(
        (item) =>
          (filter === "all"
            ? true
            : filter === "nouveaute"
              ? item.year >= NEW_SINCE && item.year <= CURRENT_YEAR
              : item.category === filter) &&
          (genre === "all" || item.genres.includes(genre)) &&
          (platform === "all" || item.platforms.includes(platform)) &&
          (year === "all" || item.year === year),
      ),
    [catalog, filter, genre, platform, year],
  );

  const results = useMemo(() => {
    const list = searchTitles(query, filtered);
    if (sort === "default" && filter === "nouveaute") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "recent") return [...list].sort((a, b) => b.year - a.year);
    if (sort === "oldest") return [...list].sort((a, b) => a.year - b.year);
    return list;
  }, [filter, filtered, query, sort]);

  const searchMode =
    query.trim().length > 0 ||
    filter !== "all" ||
    genre !== "all" ||
    platform !== "all" ||
    year !== "all" ||
    sort !== "default";
  const numeric = /^\d+$/.test(query.trim());
  const numericHit = numeric ? findTitle(catalog, Number(query.trim())) : undefined;

  const routeSubject = route.name === "title" ? subjectFor(catalog, route.id) : null;
  const openSubject = manual ?? routeSubject;
  const openDone = openSubject ? library.history.find((item) => item.id === openSubject.id)?.done ?? false : false;

  /**
   * Home rows, Netflix style: what is new first, then one row per kind, then
   * the genres worth browsing. Every row is capped at 40 posters — "Tout voir"
   * hands the whole category over to the grid underneath.
   */
  const homeRows = useMemo<HomeRow[]>(() => {
    const withPoster = posterPool(catalog);

    const categoryRows: HomeRow[] = (["film", "serie", "anime"] as Category[]).map((category) => ({
      key: category,
      head: CATEGORY_LABEL[category],
      icon: category === "film" ? <Film size={16} /> : category === "serie" ? <Tv size={16} /> : <Sparkles size={16} />,
      items: withPoster.filter((item) => item.category === category).slice(0, 40),
      total: countByCategory(catalog, category),
      onSeeAll: () => setFilter(category),
    }));

    const genreRows: HomeRow[] = GENRE_ROWS.map((genre) => ({
      key: genre,
      head: GENRE_LABEL[genre],
      items: withPoster.filter((item) => item.genres.includes(genre)).slice(0, 40),
      onSeeAll: () => setGenre(genre),
    })).filter((row) => row.items.length >= 8);

    return [
      {
        key: "new-film",
        head: "Nouveautés films",
        icon: <Flame size={16} />,
        items: freshTitles(withPoster.filter((item) => item.category === "film")),
        large: true,
        onSeeAll: () => setFilter("nouveaute"),
      },
      {
        key: "new-serie",
        head: "Nouveautés séries",
        icon: <Flame size={16} />,
        items: freshTitles(withPoster.filter((item) => item.category === "serie")),
        large: true,
        onSeeAll: () => setFilter("nouveaute"),
      },
      ...categoryRows,
      ...genreRows,
    ];
  }, [catalog]);

  /**
   * The same block of rows, rebuilt over whatever the filters selected: picking
   * "Horreur" or "Histoire" used to drop straight to a flat grid, so the newest
   * titles of that genre had no row of their own.
   */
  const resultRows = useMemo<HomeRow[]>(() => {
    if (!searchMode || query.trim()) return [];
    const pool = posterPool(results);
    const scope = [
      platform !== "all" ? PLATFORM_LABEL[platform] : null,
      genre !== "all" ? GENRE_LABEL[genre] : null,
      year !== "all" ? String(year) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const rows: HomeRow[] = [];
    const fresh = freshTitles(pool);
    if (fresh.length)
      rows.push({
        key: "fresh",
        head: scope ? `Nouveautés ${scope}` : "Nouveautés",
        icon: <Flame size={16} />,
        items: fresh,
        large: true,
      });

    const service = platform !== "all" ? PLATFORM_LABEL[platform] : "";
    for (const category of ["film", "serie", "anime"] as Category[]) {
      const items = pool.filter((item) => item.category === category).slice(0, 40);
      if (!items.length) continue;
      rows.push({
        key: `res-${category}`,
        head: service ? `${CATEGORY_LABEL[category]} ${service}` : CATEGORY_LABEL[category],
        icon: category === "film" ? <Film size={16} /> : category === "serie" ? <Tv size={16} /> : <Sparkles size={16} />,
        items,
        total: pool.filter((item) => item.category === category).length,
      });
    }
    return rows;
  }, [genre, platform, query, results, searchMode, year]);

  // After a studio tile: once the filtered rows are on the page, glide down to
  // them, the header's height kept clear (scroll-margin on .mf-toolbar).
  useEffect(() => {
    if (!scrollToResults.current) return;
    scrollToResults.current = false;
    const frame = requestAnimationFrame(() => {
      document.querySelector(".mf-toolbar")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [platform]);

  function openTitle(item: Title, at?: { season: number; episode: number; progress?: number }) {
    setResume(at ? { id: item.id, ...at } : null);
    window.location.hash = `/t/${item.id}`;
  }

  function closePlayer() {
    setManual(null);
    setResume(null);
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
    setLibrary(
      recordWatch(libId, {
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
    const current = library.history.find((item) => item.id === id)?.done ?? false;
    setLibrary(markDone(libId, id, !current));
  }

  /**
   * Position reported by the player page (through the proxy). Values that move
   * by less than a point are dropped: the rail would otherwise re-render and
   * rewrite localStorage every few seconds for no visible change.
   */
  function handleProgress(update: { season: number; episode: number; ratio: number }) {
    const subject = openSubject;
    if (!subject) return;
    const key = `${subject.id}:${update.season}:${update.episode}`;
    const last = progressRef.current;
    if (last.key === key && Math.abs(last.ratio - update.ratio) < 0.01) return;
    progressRef.current = { key, ratio: update.ratio };

    setLibrary(() => {
      if (!readLibrary(libId).history.some((item) => item.id === subject.id)) {
        recordWatch(libId, {
          id: subject.id,
          title: subject.title,
          poster: subject.poster ?? null,
          year: subject.year ?? null,
          type: subject.type,
          category: subject.category ?? (subject.type === "movie" ? "film" : "serie"),
          ...(subject.type === "series" ? { season: update.season, episode: update.episode } : {}),
        });
      }
      return recordProgress(
        libId,
        subject.id,
        subject.type === "series" ? { season: update.season, episode: update.episode } : {},
        update.ratio,
      );
    });
  }

  function resumeFrom(entry: HistoryEntry) {
    const at = { season: entry.season ?? 1, episode: entry.episode ?? 1, progress: entry.progress };
    const title = findTitle(catalog, entry.id);
    if (title) {
      openTitle(title, at);
      return;
    }
    setResume({ id: entry.id, ...at });
    setManual({
      id: entry.id,
      type: entry.type,
      title: entry.title,
      poster: entry.poster ?? undefined,
      year: entry.year,
      category: entry.category,
    });
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
    setLibrary(readLibrary(LOCAL_PROFILE_ID));
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
    setPlatform("all");
    setYear("all");
    setSort("default");
    setQuery("");
  }

  /**
   * The logo means "start over": home, no filter, no search, nothing open. It
   * used to only re-point the hash, so a search or a genre stayed stuck on the
   * page it took you back to.
   */
  function goHome() {
    resetFilters();
    setVisible(PAGE_SIZE);
    setManual(null);
    setResume(null);
    setNavOpen(false);
    if (window.location.hash) {
      history.pushState("", document.title, `${window.location.pathname}${window.location.search}`);
    }
    setRoute({ name: "home" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="mf-shell">
      <header className="mf-header">
        <a
          className="mf-logo"
          href="#/"
          aria-label="MetalFlix, retour à l'accueil"
          onClick={(event) => {
            event.preventDefault();
            goHome();
          }}
        >
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
          className="mf-nav__toggle"
          aria-expanded={navOpen}
          aria-controls="mf-nav"
          aria-label={navOpen ? "Fermer le menu" : "Ouvrir le menu"}
          onClick={() => setNavOpen((value) => !value)}
        >
          {navOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {navOpen ? (
          <button
            type="button"
            className="mf-nav__scrim"
            aria-label="Fermer le menu"
            tabIndex={-1}
            onClick={() => setNavOpen(false)}
          />
        ) : null}

        <div className="mf-nav" id="mf-nav" data-open={navOpen ? "true" : undefined}>
        <button
          type="button"
          className="mf-nav__close"
          aria-label="Fermer le menu"
          onClick={() => setNavOpen(false)}
        >
          <X size={16} />
        </button>
        <div className="mf-filters" role="group" aria-label="Filtres du catalogue">
          <Dropdown
            label="Genre"
            value={genre}
            options={genreOptions}
            onChange={(value) => {
              setGenre(value as GenreKey | "all");
              setNavOpen(false);
            }}
          />
          <Dropdown
            label="Année"
            value={String(year)}
            options={yearOptions}
            onChange={(value) => {
              setYear(value === "all" ? "all" : Number(value));
              setNavOpen(false);
            }}
          />
          <Dropdown
            label="Plateforme"
            value={platform}
            options={platformOptions}
            onChange={(value) => {
              setPlatform(value as PlatformKey | "all");
              setNavOpen(false);
            }}
          />
          <Dropdown
            label="Tri"
            value={sort}
            options={sortOptions}
            onChange={(value) => {
              setSort(value as Sort);
              setNavOpen(false);
            }}
          />
          <button
            type="button"
            className="mf-btn mf-btn--sm"
            onClick={() => {
              resetFilters();
              setNavOpen(false);
            }}
          >
            Réinitialiser
          </button>
        </div>

        <InstallButton />

        <button
          type="button"
          className="mf-account-btn"
          onClick={() => {
            setNavOpen(false);
            if (profile) window.location.hash = "/compte";
            else setAuthOpen(true);
          }}
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
        </div>
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

            {/* Kept on the results page too: it is how you switch studio, and
                tapping the active tile is the way back to the whole catalogue. */}
            <StudioRail
              counts={studioCounts}
              active={platform}
              onPick={(key) => {
                const next = platform === key ? "all" : key;
                setPlatform(next);
                // Picking a service drops straight down to its titles.
                if (next !== "all") scrollToResults.current = true;
              }}
            />

            <TopRail items={topFilms} onOpen={openTitle} />

            {!searchMode && resumable.length > 0 ? (
              <ResumeRail
                items={resumable}
                onResume={resumeFrom}
                onDismiss={(id) => setLibrary(removeHistory(libId, id))}
              />
            ) : null}

            <section className="mf-toolbar" aria-label="Filtres">
              <div className="mf-seg" role="tablist" aria-label="Catégories">
                {FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    className={`mf-seg__btn mf-seg__btn--${value}${filter === value ? " is-active" : ""}`}
                    onClick={() => setFilter(value)}
                  >
                    {FILTER_LABEL[value]}
                  </button>
                ))}
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
                  <p>Essayez un autre mot-clé, un autre genre, ou collez un identifiant de titre pour ouvrir le lecteur.</p>
                </div>
              </section>
            ) : null}

            {searchMode ? (
              results.length > 0 && (
                <>
                  {resultRows.map((row) => (
                    <Rail
                      key={row.key}
                      head={row.head}
                      icon={row.icon}
                      total={row.total}
                      items={row.items}
                      large={row.large}
                      onOpen={openTitle}
                      wantedIds={wantedIds}
                      onToggleWatch={(title) => toggleWatch(snapshotOf(title))}
                    />
                  ))}
                  <section className="mf-section" aria-label="Résultats">
                    <div className="mf-section__head">
                      <h2>{query.trim() ? "Résultats" : FILTER_LABEL[filter]}</h2>
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
                </>
              )
            ) : (
              homeRows.map((row) => (
                <Fragment key={row.key}>
                  <Rail
                    head={row.head}
                    icon={row.icon}
                    total={row.total}
                    items={row.items}
                    large={row.large}
                    onSeeAll={row.onSeeAll}
                    onOpen={openTitle}
                    wantedIds={wantedIds}
                    onToggleWatch={(title) => toggleWatch(snapshotOf(title))}
                  />
                  {/* Right under the new releases, the way the reference lays it out. */}
                  {row.key === "new-serie" ? (
                    <TopRail items={topSeries} onOpen={openTitle} title="Top 10 des séries aujourd'hui" series />
                  ) : null}
                </Fragment>
              ))
            )}
          </>
        )}

        <footer className="mf-footer">
          <div className="mf-thanks">
            <h2>Merci aux bêta-testeurs</h2>
            <p>
              Les tout premiers à avoir essayé MetalFlix, à signaler les bugs et à aider à les régler — une bonne
              partie de ce qui marche aujourd'hui vient de leurs retours.
            </p>
            <ul className="mf-thanks__list">
              <li>Hyska</li>
              <li>Volrod</li>
              <li>Hansoleil</li>
              <li>Laura</li>
            </ul>
          </div>
          <p>
            {catalog.length.toLocaleString("fr-FR")} films, séries et animes jouables directement dans le lecteur — pas
            d'inscription, pas de clé à fournir.
          </p>
          <p>
            Le compte, l'historique et la liste restent dans ce navigateur : rien n'est envoyé ailleurs.
          </p>
          <button
            type="button"
            className="mf-footer__news"
            onClick={() => window.dispatchEvent(new Event("metalflix:update-open"))}
          >
            Nouveautés du site
          </button>
        </footer>
      </main>

      {openSubject ? (
        <PlayerModal
          key={openSubject.id}
          subject={openSubject}
          initial={resume?.id === openSubject.id ? resume : undefined}
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
          onProgress={handleProgress}
        />
      ) : null}

      {authOpen ? <AccountModal onClose={() => setAuthOpen(false)} onAuthenticated={handleAuthenticated} /> : null}

      <UpdateNotice />
    </div>
  );
}
