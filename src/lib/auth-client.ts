"use client";

import { createAuthClient } from "better-auth/react";

/** Browser-side auth client. Same-origin, so no baseURL is required. */
export const authClient = createAuthClient();
