import { createRoot } from 'react-dom/client';
import Test from './components/Test';
import ClientManager from './components/ClientManager';
import Editor from './components/Editor';

const App = () => {
	return <div>
		<ClientManager />
		<Test />
		<br />
		<Editor />
	</div>
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App/>);