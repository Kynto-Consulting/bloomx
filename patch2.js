const fs = require('fs');
const path = './src/app/calendar/page.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    /const loadData = async/g,
    `const handleOpenCreate = (st: string, en: string) => {
        setStartsAt(st);
        setEndsAt(en);
        setIsCreating(true);
        openWindo|({
            id: 'create-event',
            type: 'event',
            title: 'New Event',
            icon: <CalendarDays className="w-4 h-4"/>,
            content: (
                <CreateEventForm
                    initialStartsAt={st}
                    initialEndsAt={en}
                    onSaved={() => {
                        closeWindow('create-event');
                        setIsCreating(false);
                        void loadData();
                    }}
                    onClose={() => {
                        closeWindow('create-event');
                        setIsCreating(false);
                    }}
                	/>
            )
        });
    };

    const loadData = async`
);

code = code.replace(
    /setStartsAt\\(d\\.toISOString\\(\\)\\.slice\\(0, 16\\)\\);\\s*const dEnd = new Date\\(d\\.getTime\\(\\) \\+ 60 * 60 * 1000\\);?.*?\\s*setEndsAt\\(dEndd\\.toISOString\\(\\)\\.slice\\(0, 16\\)\\);\\s*setIsCreating\\(true\\);/gs,
    `handleOpenCreate(d.toISOString().slice(0, 16), (new Date(d.getTime() + 60 * 60 * 1000)).toISOString().slice(0, 16));`
);

code = code.replace(
    /onClick=\\{\\(\\) => setIsCreating\\\(!\\bisCreating\\*\\)\\}/g,
    `onClick={() => handleOpenCreate((new Date()).toISOString().slice(0, 16), (new Date(Date.now() + 60 * 60 * 1000)).toISOString().slice(0, 16))}`
);

code = code.replace(
    /\\{!\isCreating && \\($[\\s\\S]*?<\\/form>\\s*<\\/div>\\s*\\)\\}/g,
    `{/* Global window context handles 'isCreating' modal now */}`
);

code = code.replace(
    /import \{ExtensionLoader\} from '@\\/components\\/expansions\\/ExtensionLoader';/g,
    `import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';
import { useGlobalWindow } from '@/contexts/GlobalWindowContext';
import { CreateEventForm } from '@/components/calendar/CreateEventForm';`
);

code = code.replace(
    /const \{\\bholidays,bcountryCode\\y = settingsData\\.holidays;const \\holidays\y = countryCode;/,
    _const[..._`
);
code = code.replace(
/const \\[isCreating, setIsCreating\\] = useState\\(false\\);/,
`const { openWindow, closeWindow } = useGlobalWindow();
    const [isCreating, setIsCreating = useState(false);`
);

fs.writeFileSync(path, code);
