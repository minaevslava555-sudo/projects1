"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTranslations } from "next-intl";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export type TranslatedHotspotSpot = {
  id: string;
  x: number;
  y: number;
  title: string;
  text: string;
};

export type TranslatedHotspotScene = {
  id: string;
  label: string;
  image: string;
  spots: TranslatedHotspotSpot[];
};

/** Soft room crossfade — keep previous frame until the next is ready. */
const IMAGE_CROSSFADE_S = 0.62;
const IMAGE_READY_TIMEOUT_MS = 4500;
/** Reveal markers once the incoming room has started to appear. */
const HOTSPOT_REVEAL_DELAY_MS = 140;
const HOTSPOT_STAGGER_S = 0.07;
const HOTSPOT_ENTER_S = 0.38;

function preloadImage(src: string, timeoutMs: number): Promise<"ok" | "error" | "timeout"> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: "ok" | "error" | "timeout") => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = window.setTimeout(() => finish("timeout"), timeoutMs);
    const img = new window.Image();
    img.onload = () => {
      window.clearTimeout(timer);
      finish("ok");
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish("error");
    };
    img.src = src;
    if (img.complete && img.naturalWidth > 0) {
      window.clearTimeout(timer);
      finish("ok");
    }
  });
}

function SpotMarker({
  spot,
  active,
  index,
  reducedMotion,
  onSelect,
}: {
  spot: TranslatedHotspotSpot;
  active: boolean;
  index: number;
  reducedMotion: boolean;
  onSelect: (spot: TranslatedHotspotSpot) => void;
}) {
  return (
    <motion.button
      type="button"
      className={`hotspot-marker${active ? " is-active" : ""}`}
      style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
      aria-label={spot.title}
      aria-expanded={active}
      /* Motion x/y compose with scale — keeps marker centered while entering. */
      initial={
        reducedMotion
          ? { opacity: 1, scale: 1, x: "-50%", y: "-50%" }
          : { opacity: 0, scale: 0.82, x: "-50%", y: "-50%" }
      }
      animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : {
              duration: HOTSPOT_ENTER_S,
              delay: index * HOTSPOT_STAGGER_S,
              ease: [0.22, 1, 0.36, 1],
            }
      }
      onClick={(event) => {
        event.stopPropagation();
        onSelect(spot);
      }}
      onMouseEnter={() => onSelect(spot)}
    >
      <span className="hotspot-marker-pulse" aria-hidden="true" />
      <span className="hotspot-marker-core" aria-hidden="true">
        <svg
          className="hotspot-sparkle"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          focusable="false"
        >
          <path
            fill="currentColor"
            d="M12 2.1c.32 0 .5.18.62.55l1.48 4.7c.12.38.4.66.78.78l4.7 1.48c.37.12.55.3.55.62s-.18.5-.55.62l-4.7 1.48c-.38.12-.66.4-.78.78l-1.48 4.7c-.12.37-.3.55-.62.55s-.5-.18-.62-.55l-1.48-4.7a1.15 1.15 0 0 0-.78-.78l-4.7-1.48C3.28 12.5 3.1 12.32 3.1 12s.18-.5.55-.62l4.7-1.48c.38-.12.66-.4.78-.78l1.48-4.7c.12-.37.3-.55.62-.55Z"
          />
        </svg>
      </span>
    </motion.button>
  );
}

function popupStyle(spot: TranslatedHotspotSpot): CSSProperties {
  const preferLeft = spot.x > 58;
  const preferTop = spot.y > 62;
  return {
    left: preferLeft ? "auto" : `min(calc(${spot.x}% + 1.1rem), calc(100% - 17.5rem))`,
    right: preferLeft
      ? `min(calc(${100 - spot.x}% + 1.1rem), calc(100% - 17.5rem))`
      : "auto",
    top: preferTop ? "auto" : `min(calc(${spot.y}% + 1.15rem), calc(100% - 8rem))`,
    bottom: preferTop
      ? `min(calc(${100 - spot.y}% + 1.15rem), calc(100% - 8rem))`
      : "auto",
  };
}

export default function HotspotGallery({ scenes }: { scenes: TranslatedHotspotScene[] }) {
  const t = useTranslations("ServiceDetail");
  const baseId = useId();
  const reduceMotion = useReducedMotion();
  const reducedMotion = !!reduceMotion;

  const [sceneId, setSceneId] = useState(scenes[0]?.id ?? "");
  const [displaySceneId, setDisplaySceneId] = useState(scenes[0]?.id ?? "");
  const [hotspotsVisible, setHotspotsVisible] = useState(true);
  const [activeSpotId, setActiveSpotId] = useState<string | null>(null);
  const [swapBusy, setSwapBusy] = useState(false);

  const swapGen = useRef(0);
  const revealTimer = useRef<number | null>(null);

  const displayScene =
    scenes.find((item) => item.id === displaySceneId) ?? scenes[0];
  const activeSpot =
    displayScene?.spots.find((spot) => spot.id === activeSpotId) ?? null;

  useEffect(() => {
    if (!scenes.some((item) => item.id === sceneId) && scenes[0]) {
      setSceneId(scenes[0].id);
      setDisplaySceneId(scenes[0].id);
    }
  }, [scenes, sceneId]);

  useEffect(() => {
    return () => {
      if (revealTimer.current != null) {
        window.clearTimeout(revealTimer.current);
      }
      swapGen.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!activeSpot) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveSpotId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeSpot]);

  async function selectScene(nextId: string) {
    if (!scenes.some((item) => item.id === nextId)) return;
    if (nextId === displaySceneId && !swapBusy) return;

    const gen = ++swapGen.current;
    setSceneId(nextId);
    setActiveSpotId(null);
    setHotspotsVisible(false);
    setSwapBusy(true);

    if (revealTimer.current != null) {
      window.clearTimeout(revealTimer.current);
      revealTimer.current = null;
    }

    const nextScene = scenes.find((item) => item.id === nextId);
    if (!nextScene) {
      setSwapBusy(false);
      return;
    }

    await preloadImage(nextScene.image, IMAGE_READY_TIMEOUT_MS);
    if (gen !== swapGen.current) return;

    setDisplaySceneId(nextId);

    if (reducedMotion) {
      setHotspotsVisible(true);
      setSwapBusy(false);
      return;
    }

    revealTimer.current = window.setTimeout(() => {
      if (gen !== swapGen.current) return;
      setHotspotsVisible(true);
      setSwapBusy(false);
      revealTimer.current = null;
    }, HOTSPOT_REVEAL_DELAY_MS);
  }

  if (!displayScene) return null;

  return (
    <div className="hotspot-gallery">
      {scenes.length > 1 ? (
        <div className="hotspot-scene-tabs" role="tablist" aria-label={t("roomsAria")}>
          {scenes.map((item) => {
            const selected = item.id === sceneId;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-busy={selected && swapBusy}
                className={`hotspot-scene-tab${selected ? " is-active" : ""}`}
                onClick={() => void selectScene(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="hotspot-stage" onClick={() => setActiveSpotId(null)}>
        {/* Photo viewport: image + hotspot overlay share this exact rectangle. */}
        <div className="hotspot-image-stack" aria-busy={swapBusy}>
          <AnimatePresence initial={false}>
            <motion.img
              key={displayScene.id}
              src={displayScene.image}
              alt={displayScene.label}
              className="hotspot-image hotspot-image-layer"
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : {
                      duration: IMAGE_CROSSFADE_S,
                      ease: [0.22, 1, 0.36, 1],
                    }
              }
              draggable={false}
            />
          </AnimatePresence>

          <div className="hotspot-photo-overlay">
            {/* Enter-only Motion; unmount instantly on room change so old/new never overlap. */}
            {hotspotsVisible
              ? displayScene.spots.map((spot, index) => (
                  <SpotMarker
                    key={`${displayScene.id}-${spot.id}`}
                    spot={spot}
                    index={index}
                    active={activeSpotId === spot.id}
                    reducedMotion={reducedMotion}
                    onSelect={(next) => setActiveSpotId(next.id)}
                  />
                ))
              : null}

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
                    aria-label={t("close")}
                    onClick={() => setActiveSpotId(null)}
                  >
                    ×
                  </button>
                </div>
                <p className="hotspot-popup-text">{activeSpot.text}</p>
              </div>
            ) : (
              <p className="hotspot-hint">{t("exploreHint")}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
