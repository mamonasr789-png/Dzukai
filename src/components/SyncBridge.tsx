"use client";

import { useEffect } from "react";
import { startSync } from "@/lib/sync/engine";

/** Mounts the cross-device sync engine. Renders nothing. */
export default function SyncBridge() {
  useEffect(() => startSync(), []);
  return null;
}
