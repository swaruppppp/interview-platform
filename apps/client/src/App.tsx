import { useState } from "react";
import { Lobby, type UserRole } from "./components/Lobby";
import { InterviewRoom } from "./components/InterviewRoom";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const urlRoom = (params.get("room") ?? "").toUpperCase();

  const [session, setSession] = useState<{
    roomCode: string;
    role: UserRole;
    name: string;
  } | null>(null);

  function handleEnter(roomCode: string, role: UserRole, name: string) {
    const nextUrl = `${window.location.pathname}?room=${roomCode}`;
    window.history.replaceState({}, "", nextUrl);
    setSession({ roomCode, role, name });
  }

  function handleLeave() {
    window.history.replaceState({}, "", window.location.pathname);
    setSession(null);
  }

  if (!session) {
    return <Lobby initialRoomCode={urlRoom} onEnterRoom={handleEnter} />;
  }

  return (
    <InterviewRoom
      roomCode={session.roomCode}
      role={session.role}
      name={session.name}
      onLeave={handleLeave}
    />
  );
}
