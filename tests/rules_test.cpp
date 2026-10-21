#include <cassert>
#include <cstdio>
#include "../src/common/rules.h"

int main()
{
	using namespace gthl;
	assert(BountyForKill("npc_metropolice") == 5);
	assert(BountyForKill("npc_combine_elite") == 15);

	BountyLimiter lim;
	int total = 0;
	for (int i = 0; i < 20; i++) total += lim.Allow(5, 1000 + i);
	assert(total == 60);
	assert(lim.Allow(5, 62000) == 5);

	assert(SkillForHonor(kHonorUnknown) == 2);
	assert(SkillForHonor(8) == 1);
	assert(SkillForHonor(0) == 2);
	assert(SkillForHonor(-6) == 3);

	char victim[64];
	assert(ParseKill(FormatKill("npc_zombie").c_str(), victim, sizeof victim) && std::string(victim) == "npc_zombie");
	assert(!ParseKill("HEAT 1 2", victim, sizeof victim));
	int b, h;
	assert(ParseHeat(FormatHeat(120, -1000).c_str(), &b, &h) && b == 120 && h == -1000);
	std::puts("rules_test: all passed");
}
