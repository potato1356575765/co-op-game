// The two rules from sheets/rules.json, as pure functions both sides share. No game or OS calls here,
// so tests/rules_test.cpp can check them anywhere.
#pragma once
#include <cstdio>
#include <cstring>
#include <string>
#include "../generated/sheets.h"

namespace gthl {

// HL2 -> RDR2: dollars of bounty one HL2 kill is worth.
inline int BountyForKill(const char *victimClass)
{
	using R = sheets::kill_to_bounty;
	return std::strstr(victimClass, "elite") ? R::dollars_per_combine_elite : R::dollars_per_kill;
}

// Caps how much bounty HL2 can add per rolling minute.
class BountyLimiter
{
public:
	// Returns the dollars actually allowed for a kill at nowMs.
	int Allow(int dollars, long long nowMs)
	{
		if (nowMs - windowStartMs_ >= 60000) { windowStartMs_ = nowMs; spent_ = 0; }
		int room = sheets::kill_to_bounty::max_dollars_per_minute - spent_;
		int granted = dollars < room ? dollars : (room > 0 ? room : 0);
		spent_ += granted;
		return granted;
	}

private:
	long long windowStartMs_ = -60000;
	int spent_ = 0;
};

// RDR2 -> HL2: HL2 skill (1 easy, 2 normal, 3 hard) from Arthur's honor; honor -1000 means unknown.
constexpr int kHonorUnknown = -1000;
inline int SkillForHonor(int honor)
{
	using R = sheets::honor_to_skill;
	if (honor == kHonorUnknown) return 2;
	if (honor >= R::easy_at_or_above) return 1;
	if (honor <= R::hard_at_or_below) return 3;
	return 2;
}

// Wire format (sheets/channels.json): one text line per UDP datagram.
inline std::string FormatKill(const char *victimClass) { return std::string("KILL ") + victimClass; }
inline bool ParseKill(const char *line, char *victimClass, size_t n)
{
	if (std::strncmp(line, "KILL ", 5) != 0) return false;
	std::snprintf(victimClass, n, "%s", line + 5);
	return victimClass[0] != '\0';
}
inline std::string FormatHeat(int bounty, int honor) { return "HEAT " + std::to_string(bounty) + " " + std::to_string(honor); }
inline bool ParseHeat(const char *line, int *bounty, int *honor) { return std::sscanf(line, "HEAT %d %d", bounty, honor) == 2; }

}  // namespace gthl
