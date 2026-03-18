import { Routes, Route } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { MissionDetail } from './pages/MissionDetail';
import { CustomAgents } from './pages/CustomAgents';
import { StockAgents } from './pages/StockAgents';
import { Sidebar } from './components/Sidebar';

export function App() {
  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/mission/:id" element={<MissionDetail />} />
          <Route path="/custom-agents" element={<CustomAgents />} />
          <Route path="/stock-agents" element={<StockAgents />} />
        </Routes>
      </main>
    </div>
  );
}
