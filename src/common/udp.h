// Tiny localhost UDP endpoint (Winsock), shared by the RDR2 ASI and the HL2 plugin.
#pragma once
#include <winsock2.h>
#include <ws2tcpip.h>
#include <string>
#pragma comment(lib, "ws2_32.lib")

namespace gthl {

class Udp
{
public:
	bool Open(unsigned short listenPort)
	{
		WSADATA wsa;
		if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
		sock_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
		if (sock_ == INVALID_SOCKET) return false;
		u_long nonBlocking = 1;
		ioctlsocket(sock_, FIONBIO, &nonBlocking);
		sockaddr_in a{};
		a.sin_family = AF_INET;
		a.sin_port = htons(listenPort);
		inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
		return bind(sock_, reinterpret_cast<sockaddr *>(&a), sizeof a) == 0;
	}

	void Send(unsigned short port, const std::string &line)
	{
		sockaddr_in a{};
		a.sin_family = AF_INET;
		a.sin_port = htons(port);
		inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
		sendto(sock_, line.c_str(), static_cast<int>(line.size()), 0, reinterpret_cast<sockaddr *>(&a), sizeof a);
	}

	// Returns false when nothing is waiting.
	bool Receive(char *buf, int n)
	{
		int got = recv(sock_, buf, n - 1, 0);
		if (got <= 0) return false;
		buf[got] = '\0';
		return true;
	}

	void Close()
	{
		if (sock_ != INVALID_SOCKET) closesocket(sock_);
		sock_ = INVALID_SOCKET;
		WSACleanup();
	}

private:
	SOCKET sock_ = INVALID_SOCKET;
};

}  // namespace gthl
