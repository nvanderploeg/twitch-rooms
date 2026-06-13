import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RoomView } from './components/RoomView.js';
import { AdminPanel } from './components/AdminPanel.js';

// The Engine client: `/` renders the Viewer scene (RoomView), `/admin` the
// streamer config panel. Routing lives here so <App /> is self-contained for
// tests; main.tsx just renders it.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoomView />} />
        <Route path="/admin" element={<AdminPanel />} />
      </Routes>
    </BrowserRouter>
  );
}
