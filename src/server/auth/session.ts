import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppError } from "@/server/errors";
import { getAuth } from "./auth";

/** The narrow identity object passed into services. Never the raw session. */
export interface CurrentUser {
  id: string;
  name: string;
  email: string;
}

async function readUser(requestHeaders: Headers): Promise<CurrentUser | null> {
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result?.user) return null;
  return { id: result.user.id, name: result.user.name, email: result.user.email };
}

/** For Server Components: redirects to /login when unauthenticated. */
export async function requirePageUser(): Promise<CurrentUser> {
  const user = await readUser(await headers());
  if (!user) redirect("/login");
  return user;
}

/** For Server Components that render differently for anonymous users. */
export async function getOptionalPageUser(): Promise<CurrentUser | null> {
  return readUser(await headers());
}

/** For Route Handlers: throws a 401 AppError when unauthenticated. */
export async function requireApiUser(request: Request): Promise<CurrentUser> {
  const user = await readUser(request.headers);
  if (!user) throw new AppError("UNAUTHORIZED", "You must be signed in.");
  return user;
}
