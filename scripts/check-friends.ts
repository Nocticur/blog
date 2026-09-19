import { friendsConfig } from "../src/config/friendsConfig";

const friends = friendsConfig.filter((friend) => friend.enabled && friend.url);
const failures: string[] = [];
for (const friend of friends) {
  try {
    const response = await fetch(friend.url, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!response.ok) failures.push(`${friend.name || friend.url}: HTTP ${response.status}`);
    else console.log(`ok ${friend.name || friend.url}`);
  } catch (error) {
    failures.push(`${friend.name || friend.url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`checked ${friends.length} friend links`);
