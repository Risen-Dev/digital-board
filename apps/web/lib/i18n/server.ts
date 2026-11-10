import "server-only";
import { cookies, headers } from "next/headers";
import { pickLocale, translator } from ".";

export const getLocale = async () => pickLocale((await cookies()).get("lang")?.value, (await headers()).get("accept-language"));
export const getTr = async () => translator(await getLocale());
