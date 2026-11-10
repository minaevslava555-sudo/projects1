"use client";

import { useEffect, useId, useState } from "react";
import type { HotspotScene, HotspotSpot } from "@/lib/service-hotspots";

function BodySilhouette() {
  return (
    <svg
      viewBox="0 0 200 420"
      className="hotspot-body-svg mx-auto h-full w-auto max-h-[34rem]"
      aria-hidden="true"
    >
      <ellipse cx="100" cy="42" rx="28" ry="34" fill="currentColor" opacity="0.18" />
      <path
        d="M72 78 C72 70 128 70 128 78 L138 150 C142 175 136 190 128 205 L122 250 L130 340 L118 400 L100 400 L82 400 L70 340 L78 250 L72 205 C64 190 58 175 62 150 Z"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M62 120 C40 135 34 165 42 190 L58 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="18"
        strokeLinecap="round"
        opacity="0.14"
      />
      <path
        d="M138 120 C160 135 166 165 158 190 L142 200"
        fill="none"
        stroke="currentColor"
        strokeWidth="18"
        strokeLinecap="round"
        opacity="0.14"
      />
    </svg>
  );
}

function SpotMarker({
  spot,
  active,
  onSelect,
}: {
  spot: HotspotSpot;
  active: boolean;
  onSelect: (spot: HotspotSpot) => void;
}) {
  return (
    <button
      type="button"
      className={`hotspot-marker${active ? " is-active" : ""}`}
      style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
      aria-label={spot.title}
      aria-expanded={active}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(spot);
      }}
    >
      <span className="hotspot-marker-pulse" aria-hidden="true" />
      <span className="hotspot-marker-core" aria-hidden="true">
        +
      </span>
    </button>
  );
}

export default function HotspotGallery({ scenes }: { scenes: HotspotScene[] }) {
  const baseId = useId();
  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? "");
  const [activeSpotId, setActiveSpotId] = useState<string | null>(null);

  const scene = scenes.find((item) => item.id === sceneId) ?? scenes[0];
  const activeSpot = scene?.spots.find((spot) => spot.id === activeSpotId) ?? null;

  useEffect(() => {
    setActiveSpotId(null);
  }, [sceneId]);

  useEffect(() => {
    if (!activeSpot) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveSpotId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSpot]);

  if (!scene) return null;

  return (
    <div className="hotspot-gallery">
      {scenes.length > 1 ? (
        <div className="hotspot-scene-tabs" role="tablist" aria-label="Rooms">
          {scenes.map((item) => {
            const selected = item.id === scene.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`hotspot-scene-tab${selected ? " is-active" : ""}`}
                onClick={() => setSceneId(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div
        className={`hotspot-stage${scene.kind === "svg-body" ? " hotspot-stage-body" : ""}`}
        onClick={() => setActiveSpotId(null)}
      >
        {scene.kind === "svg-body" ? (
          <div className="hotspot-body-wrap text-ink">
            <BodySilhouette />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={scene.image} alt={scene.label} className="hotspot-image" />
        )}

        {scene.spots.map((spot) => (
          <SpotMarker
            key={spot.id}
            spot={spot}
            active={activeSpotId === spot.id}
            onSelect={(next) =>
              setActiveSpotId((current) => (current === next.id ? null : next.id))
            }
          />
        ))}

        {activeSpot ? (
          <div
            id={`${baseId}-popup`}
            className="hotspot-popup"
            role="dialog"
            aria-label={activeSpot.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="hotspot-popup-head">
              <h3 className="hotspot-popup-title">{activeSpot.title}</h3>
              <button
                type="button"
                className="hotspot-popup-close"
                aria-label="Close"
                onClick={() => setActiveSpotId(null)}
              >
                ×
              </button>
            </div>
            <p className="hotspot-popup-text">{activeSpot.text}</p>
          </div>
        ) : (
          <p className="hotspot-hint">Tap a pulsing marker to learn more</p>
        )}
      </div>
    </div>
  );
}
