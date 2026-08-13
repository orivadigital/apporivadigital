import { invokeAdminFunction, jsonError } from "../../../../lib/oriva-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return Response.json(await invokeAdminFunction(request, { action: "bootstrap_status" }));
  } catch (error) {
    return jsonError(error);
  }
}
