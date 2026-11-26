"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { INITIAL_REVIEW_SESSION, failureMessage, reviewSessionReducer } from "@/features/review/session";
import { startReview } from "@/features/review/stream";

/**
 * Runs a review against `/api/review` and folds its events into a
 * `ReviewSession`. One run at a time: starting again or cancelling aborts the
 * in-flight request, which also stops the graph server-side.
 */
export function useReviewSession() {
  const [session, dispatch] = useReducer(reviewSessionReducer, INITIAL_REVIEW_SESSION);
  const controllerRef = useRef<AbortController | null>(null);

  const start = useCallback(async (text: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "started", text });
    try {
      for await (const event of startReview(text, controller.signal)) {
        if (controller.signal.aborted) return;
        dispatch({ type: "event", event });
      }
    } catch (error) {
      // Aborts are cancellations (already dispatched) or a newer run taking over.
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", message: failureMessage(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "cancelled" });
  }, []);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { session, start, cancel, reset };
}
