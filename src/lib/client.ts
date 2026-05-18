import { treaty } from "@elysiajs/eden";

import type { App } from "../app/api/[[...slugs]]/route";

const baseUrl =
  typeof window !== "undefined" ? window.location.origin : "";

export const client = treaty<App>(baseUrl).api;
