"use client";

import { useEffect, useId, useState, type CSSProperties } from "react";
import type { HotspotScene, HotspotSpot } from "@/lib/service-hotspots";

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
      onMouseEnter={() => onSelect(spot)}
    >
      <span className="hotspot-marker-ping" aria-hidden="true" />
      <span className="hotspot-marker-core" aria-hidden="true">
        +
      </span>
    </button>
  );
}

function popupStyle(spot: HotspotSpot): CSSProperties {
  const preferLeft = spot.x > 58;
  const preferTop = spot.y > 62;
  return {
    left: preferLeft ? "auto" : `min(calc(${spot.x}% + 1.1rem), calc(100% - 17.5rem))`,
    right: preferLeft ? `min(calc(${100 - spot.x}% + 1.1rem), calc(100% - 17.5rem))` : "auto",
    top: preferTop ? "auto" : `min(calc(${spot.y}% + 1.15rem), calc(100% - 8rem))`,
    bottom: preferTop ? `min(calc(${100 - spot.y}% + 1.15rem), calc(100% - 8rem))` : "auto",
  };
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

      <div className="hotspot-stage" onClick={() => setActiveSpotId(null)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={scene.image}
          alt={scene.label}
          className="hotspot-image"
          loading="lazy"
        />

        {scene.spots.map((spot) => (
          <SpotMarker
            key={spot.id}
            spot={spot}
            active={activeSpotId === spot.id}
            onSelect={(next) => setActiveSpotId(next.id)}
          />
        ))}

        {activeSpot ? (
          <div
            id={`${baseId}-popup`}
            className="hotspot-popup"
            role="dialog"
            aria-label={activeSpot.title}
            style={popupStyle(activeSpot)}
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
          <p className="hotspot-hint">Hover or tap + to explore</p>
        )}
      </div>
    </div>
  );
}
