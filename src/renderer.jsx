import { createRoot } from 'react-dom/client';
import Test from './components/Test';
import ClientManager from './components/ClientManager';

const App = () => {
  return <div>
    <ClientManager />
  </div>
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App/>);