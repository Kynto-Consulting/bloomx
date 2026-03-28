const fs = require('fs');
const path = './src/app/contacts/page.tsx';
let code = fs.readFileSync(path, 'utf8');

// replace imports
code = code.replace(
    /import \{ ExtensionLoader \} from '@\/components\/expansions\/ExtensionLoader';/,
    `import { ExtensionLoader } from '@/components/expansions/ExtensionLoader';\nimport { useGlobalWindow } from '@/contexts/GlobalWindowContext';\nimport { CreateContactForm } from '@/components/contacts/CreateContactForm';`
);

// Add useGlobalWindow hook and handler
code = code.replace(
    /const \[isCreating, setIsCreating\] = useState\(false\);[^]*?const loadContacts = async/g,
    `const { openWindow, closeWindow } = useGlobalWindow();
    
    const handleOpenCreateContact = () => {
        openWindow({
            id: 'create-contact',
            type: 'contact',
            title: 'Create Contact',
            icon: <User className="w-4 h-4"/>,
            content: (
                <CreateContactForm
                    onSaved={() => {
                        closeWindow('create-contact');
                        void loadContacts();
                    }}
                    onClose={() => closeWindow('create-contact')}
                />
            )
        });
    };

    const loadContacts = async`
);

// Replace button click
code = code.replace(
    /onClick=\{\(\) => setIsCreating\(!isCreating\)\}/g,
    `onClick={handleOpenCreateContact}`
);

// Remove the absolute div modal
code = code.replace(
    /\{isCreating && \([\s\S]*?<\/form>\s*<\/div>\s*\)\}/g,
    `{/* Global window context handles 'isCreating' modal now */}`
);

fs.writeFileSync(path, code);