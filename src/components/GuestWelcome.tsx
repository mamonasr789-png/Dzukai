"use client";

import { useEffect, useState } from "react";

const GUEST_MAP: Record<string, { greeting: string; sub: string }> = {
  "8N4K2P7XQ9": { greeting: "Sveika, Eva!", sub: "Malonu Jus matyti." },
  "3LX9R2MW8K": { greeting: "Sveikas, Karoli!", sub: "Malonu Jus matyti." },
};

const SESSION_KEY = "gw_shown";

export default function GuestWelcome() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [guest, setGuest] = useState<{ greeting: string; sub: string } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const params = new URLSearchParams(window.location.search);
    const sid = params.get("sid");
    if (!sid || !GUEST_MAP[sid]) return;

    sessionStorage.setItem(SESSION_KEY, "1");
    setGuest(GUEST_MAP[sid]);
    setVisible(true);

    const fadeTimer = setTimeout(() => setFading(true), 2500);
    const hideTimer = setTimeout(() => setVisible(false), 3200);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible || !guest) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(5, 5, 15, 0.88)",
        backdropFilter: "blur(8px)",
        transition: "opacity 0.7s ease",
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <div
        style={{
          textAlign: "center",
          padding: "2.5rem 3rem",
          borderRadius: "1.25rem",
          border: "1px solid rgba(255,215,0,0.18)",
          background: "rgba(20, 18, 30, 0.92)",
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
          maxWidth: "90vw",
        }}
      >
        <p
          style={{
            fontSize: "clamp(1.6rem, 5vw, 2.2rem)",
            fontWeight: 700,
            color: "#f5e6b8",
            letterSpacing: "0.01em",
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {guest.greeting}
        </p>
        <p
          style={{
            fontSize: "clamp(0.95rem, 3vw, 1.1rem)",
            color: "rgba(245,230,184,0.6)",
            marginTop: "0.6rem",
            marginBottom: 0,
            fontWeight: 400,
            letterSpacing: "0.04em",
          }}
        >
          {guest.sub}
        </p>
      </div>
    </div>
  );
}
