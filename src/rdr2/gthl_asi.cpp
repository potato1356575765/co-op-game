// gthl.asi: the RDR2 half of Grand Theft Half Life, loaded by Ultimate ASI Loader.
// Every game tick (hooks.script_tick) it applies HL2 kills as bounty and sends Arthur's heat to HL2.
// It stays inert in Red Dead Online.
#include <windows.h>
#include <atomic>
#include "natives.h"
#include "../common/rules.h"
#include "../common/udp.h"

namespace gthl::rdr {

NativeHandler FindNativeHandler(uint64_t)
{
	return nullptr;  // hooks.native_lookup: unresolved, see sheets/hooks.json
}

int GetHonor()
{
	return kHonorUnknown;  // hooks.get_honor: unresolved, see sheets/hooks.json
}

static Udp g_udp;
static BountyLimiter g_limiter;
static long long g_lastHeatMs = 0;

// Called once per game frame on the script thread (hooks.script_tick).
void OnScriptTick()
{
	if (InOnline()) return;
	long long now = static_cast<long long>(GetTickCount64());
	int player = PlayerId();

	char line[128], victim[64];
	while (g_udp.Receive(line, sizeof line))
	{
		if (!ParseKill(line, victim, sizeof victim)) continue;
		int dollars = g_limiter.Allow(BountyForKill(victim), now);
		if (dollars > 0) AddBounty(player, dollars);
	}

	if (now - g_lastHeatMs >= 1000)
	{
		g_lastHeatMs = now;
		g_udp.Send(sheets::PORT_RDR_HEAT, FormatHeat(GetBounty(player), GetHonor()));
	}
}

// hooks.script_tick: installs a hook that calls OnScriptTick. Unresolved, see sheets/hooks.json.
static bool InstallScriptTickHook() { return false; }

}  // namespace gthl::rdr

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID)
{
	if (reason == DLL_PROCESS_ATTACH)
	{
		DisableThreadLibraryCalls(module);
		if (gthl::rdr::g_udp.Open(gthl::sheets::PORT_HL2_KILL)) gthl::rdr::InstallScriptTickHook();
	}
	else if (reason == DLL_PROCESS_DETACH)
	{
		gthl::rdr::g_udp.Close();
	}
	return TRUE;
}
