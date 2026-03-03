const MAX_MEMORY_ENTRIES = 20;

let memory = [];

export function addToMemory(entry) {
  memory.push(entry);
  if (memory.length > MAX_MEMORY_ENTRIES) {
    memory = memory.slice(-MAX_MEMORY_ENTRIES);
  }
}

export function getSessionMemory() {
  return [...memory];
}

export function clearSessionMemory() {
  memory = [];
}
