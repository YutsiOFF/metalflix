import { MetalBadge, MetalButton, MetalText } from "argentui";
import { Play, Sparkles } from "lucide-react";
import type { Title } from "../lib/catalog";

interface HeroProps {
  item: Title;
  onPlay: (item: Title) => void;
  titleSize?: number;
}

export default function Hero({ item, onPlay, titleSize = 92 }: HeroProps) {
  return (
    <section className="mf-hero" aria-labelledby="hero-title">
      <div className="mf-hero__backdrop" style={{ backgroundImage: `url(${item.poster})` }} aria-hidden="true" />
      <div className="mf-hero__veil" aria-hidden="true" />
      <div className="mf-hero__inner">
        <p className="mf-eyebrow">
          <Sparkles size={14} /> À la une aujourd'hui
        </p>
        <MetalText
          as="h1"
          id="hero-title"
          tone="silver"
          fontSize={titleSize}
          fontWeight={900}
          speed={0.55}
          className="mf-hero__title"
        >
          {item.title}
        </MetalText>
        <div className="mf-hero__meta">
          <MetalBadge tone="silver">{item.anime ? "ANIME" : item.type === "series" ? "SÉRIE" : "FILM"}</MetalBadge>
          <span className="mf-hero__year">{item.year || "—"}</span>
        </div>
        <div className="mf-hero__actions">
          <MetalButton tone="gold" size="lg" icon={<Play size={18} />} onClick={() => onPlay(item)}>
            Lecture
          </MetalButton>
          <a
            className="mf-link"
            href={`https://api.moviez.ac/api/check/${item.id}`}
            target="_blank"
            rel="noreferrer noopener"
          >
            Fiche API
          </a>
        </div>
      </div>
    </section>
  );
}
