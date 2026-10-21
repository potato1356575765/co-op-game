// Calling RDR2 natives from a plain ASI (no Script Hook RDR2, which players would have to install by hand).
// The two pattern-scan hooks below are open rows in sheets/hooks.json (native_lookup, script_tick):
// they must be found in the current RDR2.exe on a PC with the game before this can run.
#pragma once
#include <cstdint>
#include <type_traits>
#include "../generated/sheets.h"

namespace gthl::rdr {

struct NativeContext
{
	void *ret;
	uint32_t argCount;
	void *args;
	uint32_t dataCount;
	uint64_t argBuf[16];
	uint64_t retBuf[4];
};
using NativeHandler = void (*)(NativeContext *);

// Resolved by FindNativeHandler (hooks.native_lookup). Returns nullptr until resolved.
NativeHandler FindNativeHandler(uint64_t hash);

template <typename R, typename... A>
R Invoke(uint64_t hash, A... a)
{
	NativeContext c{};
	c.ret = c.retBuf;
	c.args = c.argBuf;
	uint64_t vals[] = {0, static_cast<uint64_t>(a)...};
	for (size_t i = 0; i < sizeof...(A); i++) c.argBuf[i] = vals[i + 1];
	c.argCount = sizeof...(A);
	NativeHandler h = FindNativeHandler(hash);
	if (!h) return R{};
	h(&c);
	if constexpr (!std::is_void_v<R>) return *reinterpret_cast<R *>(c.retBuf);
}

inline int PlayerId() { return Invoke<int>(sheets::NATIVE_PLAYER_ID); }
inline int GetBounty(int player) { return Invoke<int>(sheets::NATIVE_GET_BOUNTY, player); }
inline void AddBounty(int player, int dollars) { Invoke<void>(sheets::NATIVE_ADD_BOUNTY, player, dollars); }
inline bool InOnline() { return Invoke<int>(sheets::NATIVE_NETWORK_IS_GAME_IN_PROGRESS) != 0; }

// hooks.get_honor: honor is a story-script global, not a native. Returns kHonorUnknown until resolved.
int GetHonor();

}  // namespace gthl::rdr
