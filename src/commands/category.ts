import { Command } from 'commander';
import { openDb } from '../db/schema.js';
import { Queries } from '../db/queries.js';

export function registerCategoryCommands(program: Command): void {
  const category = program.command('category').description('Manage categories');

  category
    .command('add <name>')
    .description('Create a new category (use "Parent/Child" for nested)')
    .action((name: string) => {
      const db = openDb();
      const q = new Queries(db);

      if (name.includes('/')) {
        const parts = name.split('/');
        const parentName = parts[0];
        const childName = parts.slice(1).join('/');

        let parent = q.getCategoryByName(parentName);
        if (!parent) {
          parent = q.createCategory(parentName);
          console.log(`Created parent category: "${parent.name}" (id=${parent.id})`);
        }

        const existing = q.getCategories().find(
          (c) => c.name === childName && c.parent_id === parent!.id
        );
        if (existing) {
          console.log(`Category already exists: "${childName}" under "${parentName}"`);
        } else {
          const child = q.createCategory(childName, parent.id);
          console.log(`Created category: "${parentName}/${child.name}" (id=${child.id})`);
        }
      } else {
        const existing = q.getCategoryByName(name);
        if (existing) {
          console.log(`Category already exists: "${name}" (id=${existing.id})`);
        } else {
          const cat = q.createCategory(name);
          console.log(`Created category: "${cat.name}" (id=${cat.id})`);
        }
      }
    });

  category
    .command('list')
    .description('List all categories')
    .action(() => {
      const db = openDb();
      const q = new Queries(db);
      const categories = q.getCategories();

      if (categories.length === 0) {
        console.log('No categories found.');
        return;
      }

      const roots = categories.filter((c) => c.parent_id == null);
      const children = categories.filter((c) => c.parent_id != null);

      for (const root of roots) {
        console.log(`[${root.id}] ${root.name}`);
        const subs = children.filter((c) => c.parent_id === root.id);
        for (const sub of subs) {
          console.log(`  [${sub.id}] ${sub.name}`);
        }
      }

      // orphans (parent deleted but child remains)
      const orphans = children.filter((c) => !roots.find((r) => r.id === c.parent_id));
      for (const o of orphans) {
        console.log(`[${o.id}] ${o.name} (orphan)`);
      }
    });

  category
    .command('rename <old-name> <new-name>')
    .description('Rename a category')
    .action((oldName: string, newName: string) => {
      const db = openDb();
      const q = new Queries(db);
      const cat = q.getCategoryByName(oldName);
      if (!cat) {
        console.error(`Category not found: "${oldName}"`);
        process.exit(1);
      }
      q.renameCategory(cat.id, newName);
      console.log(`Renamed category "${oldName}" -> "${newName}"`);
    });
}
