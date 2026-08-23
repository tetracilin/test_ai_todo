import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { act } from 'react';

// React 19 removed React.act as a property; react-dom/test-utils still calls React.act(). Patch it.
if (typeof (React as Record<string, unknown>).act !== 'function') {
  (React as Record<string, unknown>).act = act;
}

// Auth and data persistence are fully local now — no network SDK to shim.
// Unit tests run offline against the real localStorage-backed stores
// (jsdom provides a per-test localStorage implementation).
