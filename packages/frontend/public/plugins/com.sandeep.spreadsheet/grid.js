// The per-block-instance UI (DESIGN.md §9.4's `render` spec) — loaded in
// its own sandboxed iframe, one per `spreadsheet` block inserted into a
// note. Deliberately simple (a grid of text cells, no formulas) — this is
// the reference implementation demonstrating the plugin architecture end to
// end, not a real spreadsheet engine.
import { FlowNoteBlock } from '@flownote/sdk';
const block = new FlowNoteBlock();
const root = document.getElementById('grid');
function render(rows, cols, data) {
    root.innerHTML = '';
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.fontFamily = 'system-ui, sans-serif';
    table.style.fontSize = '13px';
    for (let r = 0; r < rows; r++) {
        const tr = document.createElement('tr');
        for (let c = 0; c < cols; c++) {
            const td = document.createElement('td');
            td.style.border = '1px solid #d1d5db';
            const input = document.createElement('input');
            const key = `${r},${c}`;
            input.value = data[key] ?? '';
            input.style.width = '72px';
            input.style.height = '24px';
            input.style.border = 'none';
            input.style.padding = '2px 4px';
            input.addEventListener('change', () => {
                const next = { ...data, [key]: input.value };
                data = next;
                block.updateAttrs({ rows, cols, data: next });
                // Also demonstrates plugin.storage (DESIGN.md §9.7 step 5) — the
                // node attrs above are what's actually persisted through the
                // normal segment-save path; this is a parallel, separately-keyed
                // copy purely to exercise the isolated storage round-trip live.
                void block.storage.set(`sheet-${blockId}`, JSON.stringify(next));
            });
            td.appendChild(input);
            tr.appendChild(td);
        }
        table.appendChild(tr);
    }
    root.appendChild(table);
    block.reportHeight(rows * 28 + 16);
}
let blockId = '';
block.onInit((id, attrs) => {
    blockId = id;
    const rows = typeof attrs.rows === 'number' ? attrs.rows : 5;
    const cols = typeof attrs.cols === 'number' ? attrs.cols : 4;
    const data = attrs.data ?? {};
    render(rows, cols, data);
});
