import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { session } from "../shared/session";
const EntryPage = lazy(() =>
  import("../features/entry/EntryPage").then((module) => ({
    default: module.EntryPage,
  })),
);
const MoviesPage = lazy(() =>
  import("../features/movies/MoviesPage").then((module) => ({
    default: module.MoviesPage,
  })),
);
const RoomPage = lazy(() =>
  import("../features/room/RoomPage").then((module) => ({
    default: module.RoomPage,
  })),
);
function Guard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return session.name() ? (
    children
  ) : (
    <Navigate replace to={`/?next=${encodeURIComponent(location.pathname)}`} />
  );
}
export function App() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-dvh place-items-center bg-black">
          <span className="size-8 animate-spin rounded-full border-2 border-white/15 border-t-white" />
        </main>
      }
    >
      <Routes>
        <Route path="/" element={<EntryPage />} />
        <Route
          path="/movies"
          element={
            <Guard>
              <MoviesPage />
            </Guard>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <Guard>
              <RoomPage />
            </Guard>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
