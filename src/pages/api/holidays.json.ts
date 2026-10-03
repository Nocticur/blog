import { getHolidays } from "@/utils/holiday-data";

export type { HolidayEntry } from "@/utils/holiday-data";
export async function GET() {
	return Response.json(await getHolidays());
}
