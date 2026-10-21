// gthl: the Half-Life 2 half of Grand Theft Half Life, a Source server plugin (addons/gthl.vdf).
// Sends every NPC Gordon kills to RDR2 and sets HL2's skill from Arthur's honor.
// Build against Source SDK 2013 (ValveSoftware/source-sdk-2013), starting from serverplugin_empty.
#include "eiface.h"
#include "engine/iserverplugin.h"
#include "igameevents.h"
#include "tier1/tier1.h"
#include "tier1/convar.h"
#include "../common/rules.h"
#include "../common/udp.h"

IGameEventManager2 *g_events = nullptr;
IVEngineServer *g_engine = nullptr;

class GthlPlugin : public IServerPluginCallbacks, public IGameEventListener2
{
public:
	bool Load(CreateInterfaceFn factory, CreateInterfaceFn) override
	{
		ConnectTier1Libraries(&factory, 1);
		g_events = static_cast<IGameEventManager2 *>(factory(INTERFACEVERSION_GAMEEVENTSMANAGER2, nullptr));
		g_engine = static_cast<IVEngineServer *>(factory(INTERFACEVERSION_VENGINESERVER, nullptr));
		if (!g_events || !g_engine || !g_pCVar) return false;
		g_events->AddListener(this, "entity_killed", true);  // hooks.entity_killed
		return udp_.Open(gthl::sheets::PORT_RDR_HEAT);
	}

	void Unload() override
	{
		if (g_events) g_events->RemoveListener(this);
		udp_.Close();
		DisconnectTier1Libraries();
	}

	void FireGameEvent(IGameEvent *event) override
	{
		// entindex 1 is the player in single player; only Gordon's kills count.
		if (event->GetInt("entindex_attacker") != 1) return;
		// entity_killed carries only entity indexes, so the victim's class comes from its edict.
		edict_t *victim = g_engine->PEntityOfEntIndex(event->GetInt("entindex_killed"));
		const char *cls = victim ? victim->GetClassName() : nullptr;
		udp_.Send(gthl::sheets::PORT_HL2_KILL, gthl::FormatKill(cls && *cls ? cls : "npc"));
	}

	void GameFrame(bool) override
	{
		char line[128];
		int bounty, honor;
		while (udp_.Receive(line, sizeof line))
		{
			if (!gthl::ParseHeat(line, &bounty, &honor)) continue;
			int skill = gthl::SkillForHonor(honor);
			if (ConVar *cv = g_pCVar->FindVar("skill"); cv && cv->GetInt() != skill) cv->SetValue(skill);  // hooks.skill_cvar
		}
	}

	const char *GetPluginDescription() override { return "Grand Theft Half Life bridge"; }
	void Pause() override {}
	void UnPause() override {}
	void LevelInit(const char *) override {}
	void ServerActivate(edict_t *, int, int) override {}
	void LevelShutdown() override {}
	void ClientActive(edict_t *) override {}
	void ClientDisconnect(edict_t *) override {}
	void ClientPutInServer(edict_t *, const char *) override {}
	void SetCommandClient(int) override {}
	void ClientSettingsChanged(edict_t *) override {}
	PLUGIN_RESULT ClientConnect(bool *, edict_t *, const char *, const char *, char *, int) override { return PLUGIN_CONTINUE; }
	PLUGIN_RESULT ClientCommand(edict_t *, const CCommand &) override { return PLUGIN_CONTINUE; }
	PLUGIN_RESULT NetworkIDValidated(const char *, const char *) override { return PLUGIN_CONTINUE; }
	void OnQueryCvarValueFinished(QueryCvarCookie_t, edict_t *, EQueryCvarValueStatus, const char *, const char *) override {}
	void OnEdictAllocated(edict_t *) override {}
	void OnEdictFreed(const edict_t *) override {}
	int GetEventDebugID() override { return EVENT_DEBUG_ID_INIT; }

private:
	gthl::Udp udp_;
};

GthlPlugin g_plugin;
EXPOSE_SINGLE_INTERFACE_GLOBALVAR(GthlPlugin, IServerPluginCallbacks, INTERFACEVERSION_ISERVERPLUGINCALLBACKS, g_plugin);
