"use client";

import type { CSSProperties } from "react";

type SkeletonProps = {
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({ className = "", style }: SkeletonProps) {
  return <span className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function Spinner({ label = "Загрузка" }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label}>
      <span className="spinner-disk" aria-hidden="true" />
    </span>
  );
}

export function TypingIndicator() {
  return (
    <span className="typing" aria-label="Агент печатает">
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}

export function ChatThreadSkeleton() {
  return (
    <div className="chat-skeleton" aria-busy="true" aria-live="polite">
      <span className="sr-only">Загрузка диалога</span>
      <div className="chat-skeleton-empty">
        <Skeleton className="skeleton-title" />
        <Skeleton className="skeleton-line" />
        <Skeleton className="skeleton-line skeleton-line-short" />
      </div>
      <div className="services-accordion" aria-hidden="true">
        <ServicesSkeleton count={3} />
      </div>
    </div>
  );
}

export function ServicesSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="services-item services-item-skeleton" aria-hidden="true">
          <div className="services-trigger">
            <span className="services-trigger-text">
              <Skeleton className="skeleton-line" style={{ width: `${58 - index * 6}%` }} />
              <Skeleton className="skeleton-line skeleton-line-tiny" style={{ width: "28%" }} />
            </span>
            <Skeleton className="skeleton-chip" />
          </div>
        </div>
      ))}
    </>
  );
}

export function AdminSkeleton() {
  return (
    <main className="admin" aria-busy="true">
      <span className="sr-only">Загрузка админки</span>
      <Skeleton className="skeleton-title" style={{ width: "12rem" }} />
      <Skeleton className="skeleton-line" style={{ width: "70%", marginTop: "0.85rem" }} />
      <Skeleton className="skeleton-line skeleton-line-short" style={{ marginTop: "0.45rem" }} />
      <div className="admin-skeleton-form">
        <Skeleton className="skeleton-label" />
        <Skeleton className="skeleton-field" />
        <Skeleton className="skeleton-label" />
        <Skeleton className="skeleton-textarea" />
        <Skeleton className="skeleton-button" />
      </div>
    </main>
  );
}
