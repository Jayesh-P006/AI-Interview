import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import os from 'os';
import fs from 'fs';
import https from 'https';
import { Jimp } from 'jimp';
import { spawn } from 'child_process';
import crypto from 'crypto';

import fetch from 'node-fetch';
if (!globalThis.fetch) {
  globalThis.fetch = fetch;
}

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  synthesizeSpeechGoogleCloud,
  transcribeAudioGoogleCloud,
  callGemini25Flash,
  getGoogleCloudStatus,
  refreshGoogleClients
} from './google_cloud_services.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// Serve static assets from public folder
app.use(express.static(path.join(__dirname, 'public')));

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SECONDARY_GROQ_API_KEY = process.env.SECONDARY_GROQ_API_KEY;

// Mock database of questions for fallback mode (includes keywords and idealAnswers)
const MOCK_DATA = {
  'javascript': [
    {
      question: "Could you explain the difference between 'let', 'const', and 'var', and what block scoping means?",
      idealAnswer: "var is function-scoped, can be re-declared, and is hoisted with undefined. let and const are block-scoped (only accessible inside the enclosing { }), cannot be re-declared in the same scope, and are hoisted to the Temporal Dead Zone (TDZ). const additionally cannot be reassigned after declaration.",
      keywords: ['scope', 'block', 'hoist', 'reassign', 'var', 'let', 'const']
    },
    {
      question: "What is the event loop in JavaScript, and how does it handle asynchronous operations?",
      idealAnswer: "The Event Loop enables non-blocking, single-threaded execution. Synchronous code runs in the Call Stack. Asynchronous tasks (like setTimeout, fetch) are handled by Web APIs and queued in the Callback/Task Queue or Microtask Queue. When the Call Stack is empty, the Event Loop pushes tasks from the queues into the stack for execution.",
      keywords: ['loop', 'stack', 'queue', 'async', 'single', 'thread', 'callback', 'promise']
    },
    {
      question: "Can you explain what a closure is and provide a practical use case for it?",
      idealAnswer: "A closure is a function that retains access to its lexical scope even when executed outside that scope. It is created when an inner function references variables in an outer function. Practical use cases include data privacy (hiding variables from external access) and partial application/currying.",
      keywords: ['scope', 'inner', 'outer', 'function', 'lexical', 'remember', 'access']
    },
    {
      question: "What is the difference between '==' and '===' in JavaScript, and why is one preferred?",
      idealAnswer: "== performs type coercion before comparing two values (converting them to a common type first), while === compares both the value and the type strictly without coercion. === is preferred to avoid unexpected coercion bugs (e.g. true == 1 is true, but true === 1 is false).",
      keywords: ['type', 'value', 'strict', 'equality', 'conversion', 'coerce']
    },
    {
      question: "How do promises work, and how does async/await syntax improve asynchronous code readability?",
      idealAnswer: "Promises represent the eventual completion or failure of an asynchronous operation. They have three states: Pending, Resolved, or Rejected. async/await is syntactic sugar over promises, allowing asynchronous code to be written sequentially and handled like synchronous code using try/catch, removing nested 'then/catch' chains.",
      keywords: ['resolve', 'reject', 'pending', 'async', 'await', 'then', 'catch']
    },
    {
      question: "What is the difference between synchronous and asynchronous code execution in JavaScript, and how does the browser event loop prevent blocking?",
      idealAnswer: "Synchronous code executes sequentially, blocking subsequent tasks until the current one finishes. Asynchronous code executes non-sequentially, offloading long-running tasks to the browser APIs and queuing callback tasks in the queue to run later when the call stack is empty. This prevents blocking the single main thread.",
      keywords: ['synchronous', 'asynchronous', 'block', 'non-blocking', 'thread', 'stack', 'queue']
    },
    {
      question: "Can you explain prototypal inheritance in JavaScript and how it differs from class-based inheritance?",
      idealAnswer: "Prototypal inheritance means objects inherit properties and methods directly from other objects via a prototype link (`__proto__`), forming a prototype chain. Class-based inheritance uses blueprints (classes) to create instances. JavaScript classes are syntactic sugar over prototypes.",
      keywords: ['prototype', 'inheritance', 'chain', 'class', 'sugar', 'delegate']
    },
    {
      question: "What are arrow functions, and how do they differ from regular functions regarding the 'this' context?",
      idealAnswer: "Arrow functions have a shorter syntax and do not bind their own 'this' value; instead, they inherit 'this' lexically from their enclosing scope. Regular functions bind 'this' dynamically based on how they are called (e.g., as a method, function, or constructor).",
      keywords: ['arrow', 'regular', 'function', 'this', 'lexical', 'bind', 'context']
    },
    {
      question: "What is the difference between map, filter, and reduce methods on JavaScript arrays?",
      idealAnswer: "map creates a new array by transforming each element. filter creates a new array containing only elements that pass a conditional test. reduce executes a reducer function on each element, accumulating them into a single final value (e.g., number, object, or array).",
      keywords: ['map', 'filter', 'reduce', 'array', 'transform', 'accumulate', 'element']
    },
    {
      question: "What is the Temporal Dead Zone (TDZ) in JavaScript, and how does it relate to hoisting?",
      idealAnswer: "The TDZ is the period between a variable's block entry and its actual declaration. Variables declared with let and const are hoisted but not initialized, remaining in the TDZ. Accessing them before their declaration line throws a ReferenceError.",
      keywords: ['temporal', 'dead', 'zone', 'tdz', 'hoist', 'let', 'const', 'referenceerror']
    }
  ],
  'react': [
    {
      question: "What are the main advantages of React's virtual DOM, and how does reconciliation work?",
      idealAnswer: "The Virtual DOM is an in-memory representation of the real DOM. When state changes, React creates a new virtual tree, compares it with the previous virtual tree (Diffing), and updates only the changed nodes in the real DOM (Reconciliation). This minimizes expensive direct DOM manipulations, enhancing UI performance.",
      keywords: ['diff', 'reconcile', 'dom', 'update', 'ui', 'render', 'tree']
    },
    {
      question: "Could you explain the difference between controlled and uncontrolled components?",
      idealAnswer: "Controlled components have their form state driven by React state via props (value and onChange handler), making React the single source of truth. Uncontrolled components store state in the DOM itself, and React accesses their values using refs (e.g. useRef) when needed, which is useful for simpler forms or third-party integrations.",
      keywords: ['state', 'ref', 'input', 'form', 'dom', 'value', 'change']
    },
    {
      question: "What are React Hooks, and what rules must be followed when using hooks like useEffect?",
      idealAnswer: "Hooks are functions that let you use state and other React features in functional components. The core rules of hooks are: 1) Only call hooks at the top level (never inside loops, conditions, or nested functions) to ensure consistent call order. 2) Only call hooks from React function components or custom hooks.",
      keywords: ['hook', 'state', 'effect', 'render', 'dependency', 'clean', 'mount']
    },
    {
      question: "How does context API differ from state management tools like Redux, and when would you use each?",
      idealAnswer: "Context API is a built-in React feature for passing data down the component tree without manual prop-drilling, suitable for low-frequency updates like themes or auth. Redux is an external library using a global store, actions, and reducers, designed for complex, high-frequency state updates, caching, middleware integration, and time-travel debugging.",
      keywords: ['store', 'provider', 'global', 'reducer', 'action', 'prop', 'drill']
    },
    {
      question: "What is the purpose of React.memo, and how does it optimize rendering performance?",
      idealAnswer: "React.memo is a higher-order component that memoizes functional components. It prevents a component from re-rendering if its props have not changed, performing a shallow comparison of props by default. It is useful for pure components that render frequently with the same props.",
      keywords: ['memo', 'prop', 're-render', 'render', 'prev', 'next', 'compare']
    },
    {
      question: "How does React's virtual DOM diffing algorithm optimize updates, and what role do 'keys' play in list rendering?",
      idealAnswer: "React's diffing algorithm compares two virtual DOM trees element-by-element. Keys help React identify which list items have changed, been added, or been removed, preventing unnecessary re-renders of unmodified siblings and maintaining correct component state.",
      keywords: ['diff', 'key', 'render', 'list', 're-render', 'state', 'sibling']
    },
    {
      question: "What is the difference between useEffect, useMemo, and useCallback hooks, and when would you use each?",
      idealAnswer: "useEffect runs side effects after rendering. useMemo memoizes a computed value to avoid expensive calculations on every render. useCallback memoizes a function definition to prevent unnecessary child re-renders due to fresh function reference generation.",
      keywords: ['effect', 'memo', 'callback', 'render', 'hook', 'reference', 'expensive']
    },
    {
      question: "What is prop-drilling, and how do Context API or custom state libraries resolve it?",
      idealAnswer: "Prop-drilling is the practice of passing props through multiple levels of intermediate components that do not need the data. Context API solves this by providing a Provider wrapper that lets children consume state directly via useContext, bypassing intermediate nodes.",
      keywords: ['prop', 'drill', 'context', 'provider', 'consume', 'intermediate', 'tree']
    },
    {
      question: "What are React custom hooks, and why would you create one?",
      idealAnswer: "Custom hooks are JavaScript functions starting with 'use' that call other hooks. They enable extracting component logic into reusable, testable functions, allowing different components to share stateful logic without duplicating code.",
      keywords: ['custom', 'hook', 'reusable', 'extract', 'logic', 'share', 'stateful']
    },
    {
      question: "What is the difference between useEffect's empty dependency array `[]` and not providing a dependency array at all?",
      idealAnswer: "An empty dependency array `[]` tells React to run the effect only once after the initial mount. Providing no dependency array at all tells React to run the effect after *every single render* of the component.",
      keywords: ['dependency', 'array', 'render', 'mount', 'run', 'effect', 'every']
    }
  ],
  'node': [
    {
      question: "What is Node.js, and how does its non-blocking event-driven I/O model work?",
      idealAnswer: "Node.js is a runtime environment built on Chrome's V8 engine that runs JavaScript server-side. Its non-blocking I/O model delegates long-running tasks (like database queries or file system reads) to the system kernel or thread pool (via libuv). Once finished, the task triggers a callback on the event loop, letting Node handle thousands of concurrent requests on a single main thread.",
      keywords: ['loop', 'event', 'async', 'single', 'thread', 'callback', 'non-blocking']
    },
    {
      question: "What are Streams in Node.js, and what are the benefits of piping streams?",
      idealAnswer: "Streams are collections of data that are read or written sequentially in chunks, rather than loading the entire file into memory at once. Piping streams connects a readable stream directly to a writable stream, managing backpressure automatically and dramatically reducing memory consumption for large file transactions.",
      keywords: ['stream', 'pipe', 'chunk', 'memory', 'buffer', 'read', 'write']
    },
    {
      question: "Can you explain how middleware works in Express.js and give an example of custom middleware?",
      idealAnswer: "Middleware functions in Express have access to the Request (req) and Response (res) objects, and the next middleware function in the cycle (next). They can run code, modify req/res objects, end the request cycle, or pass control using next(). Example: a logger middleware doing `console.log(req.url); next();`.",
      keywords: ['request', 'response', 'next', 'req', 'res', 'cycle', 'route']
    },
    {
      question: "How do you handle error propagation in asynchronous Node.js operations?",
      idealAnswer: "In async operations, errors are handled by: 1) passing them as the first argument in error-first callbacks, 2) catching them in promise chains using .catch(), or 3) enclosing async/await code in try/catch blocks. In Express, you pass async errors to next(err) so the error-handling middleware can catch and return them.",
      keywords: ['try', 'catch', 'promise', 'next', 'error', 'middleware', 'reject']
    },
    {
      question: "What is the purpose of package-lock.json, and why is it important in a team environment?",
      idealAnswer: "package-lock.json locks the exact version of every package and sub-dependency installed in the node_modules folder. This guarantees that all developers and build servers in a team environment install the exact same dependency tree, preventing 'works on my machine' version incompatibility issues.",
      keywords: ['version', 'dependency', 'lock', 'lockfile', 'install', 'team', 'deterministic']
    },
    {
      question: "What is the purpose of npm and package.json, and what is the difference between dependencies and devDependencies?",
      idealAnswer: "npm is Node's package manager. package.json holds project metadata and dependencies. dependencies are required for the application to run in production. devDependencies are only required for development and testing (e.g., linters, compilers, test runners).",
      keywords: ['npm', 'package', 'dependency', 'dev', 'production', 'metadata', 'install']
    },
    {
      question: "What is backpressure in Node.js streams, and how is it handled?",
      idealAnswer: "Backpressure occurs when a readable stream produces data faster than the writable stream can consume it. This causes data buffering in memory. Node handles this automatically when using the `.pipe()` method, pausing the reader until the writer clears its buffer.",
      keywords: ['backpressure', 'stream', 'pipe', 'buffer', 'read', 'write', 'pause', 'resume']
    },
    {
      question: "How does the cluster module in Node.js help in scaling applications?",
      idealAnswer: "The cluster module allows scaling Node applications horizontally across multiple CPU cores. Since Node runs on a single thread, clustering launches a master process that forks worker processes, all sharing the same server port and balancing load among workers.",
      keywords: ['cluster', 'scale', 'fork', 'worker', 'cpu', 'thread', 'load', 'balance']
    },
    {
      question: "What is the Event Emitter class in Node.js, and how do you use it?",
      idealAnswer: "EventEmitter is a core class that facilitates communication between objects in Node. It allows objects to emit named events that cause registered listener functions to run. You use it by importing `events`, extending the class, and calling `emit()` and `on()`.",
      keywords: ['emitter', 'event', 'listener', 'emit', 'on', 'register', 'subscribe']
    },
    {
      question: "What is the difference between require() and import (ES modules) in Node.js?",
      idealAnswer: "require() is CommonJS (synchronous loading, dynamic imports allowed anywhere, returns module.exports). import is ES Modules (asynchronous loading, static analysis, parsed before execution, requires file extensions or package.json type config).",
      keywords: ['require', 'import', 'commonjs', 'esm', 'module', 'static', 'dynamic']
    }
  ],
  'python': [
    {
      question: "What is the difference between lists and tuples in Python, and when would you use each?",
      idealAnswer: "Lists are mutable (can be edited after creation, written with square brackets `[]`), whereas tuples are immutable (cannot be altered, written with parentheses `()`). Lists are used for dynamic collections of identical types. Tuples are used for fixed sequences of data, records, dictionary keys, and are faster and memory-efficient.",
      keywords: ['mutable', 'immutable', 'list', 'tuple', 'bracket', 'parenthes']
    },
    {
      question: "How does memory management work in Python, specifically regarding garbage collection?",
      idealAnswer: "Python manages memory automatically using reference counting and a cyclic garbage collector. Every object has a count of references pointing to it. When an object's reference count drops to zero, Python immediately deallocates it. The cyclic garbage collector runs periodically to detect and delete groups of objects with circular references.",
      keywords: ['garbage', 'reference', 'count', 'cycle', 'collector', 'alloc']
    },
    {
      question: "Can you explain decorators in Python and write a simple example of one?",
      idealAnswer: "A decorator is a design pattern in Python that wraps another function to extend or modify its behavior without permanently altering the code. It is written using the '@decorator_name' syntax. Example: \n```python\ndef my_decorator(func):\n    def wrapper():\n        print('Before call')\n        func()\n        print('After call')\n    return wrapper\n```",
      keywords: ['decorator', 'wrap', 'function', 'arg', 'modify', 'behavi']
    },
    {
      question: "What are generators and yield statements in Python, and how do they save memory?",
      idealAnswer: "Generators are functions that return an iterator using the 'yield' statement instead of 'return'. Instead of computing all values at once and storing them in memory, yield pauses function execution and returns one value at a time on demand. This enables lazy evaluation, saving significant memory for massive or infinite sequences.",
      keywords: ['yield', 'generator', 'iterator', 'memory', 'lazy', 'next']
    },
    {
      question: "What is the difference between deep copy and shallow copy in Python?",
      idealAnswer: "A shallow copy constructs a new compound object and inserts references to the original nested objects, meaning modifications to inner lists affect both copies. A deep copy recursively copies the original object and all nested objects, creating completely independent data structures with no shared references.",
      keywords: ['reference', 'copy', 'nested', 'object', 'recursive', 'clone']
    },
    {
      question: "What is PEP 8, and why is it important in the Python community?",
      idealAnswer: "PEP 8 is the official style guide for writing Python code. It defines conventions for indentation, naming, line length, and spacing, ensuring consistency, code readability, and easy collaboration across the Python community.",
      keywords: ['pep8', 'style', 'guide', 'read', 'consistent', 'name', 'format']
    },
    {
      question: "What are list comprehensions in Python, and how do they differ from map/filter?",
      idealAnswer: "List comprehensions offer a concise syntax to create lists based on existing lists. E.g. `[x*2 for x in nums if x > 2]`. They combine map and filter operations, are often faster, and are considered more readable and 'Pythonic' than map/filter.",
      keywords: ['comprehension', 'list', 'map', 'filter', 'pythonic', 'syntax', 'bracket']
    },
    {
      question: "How do you handle exceptions in Python, and what is the purpose of the 'finally' block?",
      idealAnswer: "Exceptions are handled using a try-except block. The 'try' block contains code that might raise an error. The 'except' block catches it. The 'finally' block executes cleanup code *always*, regardless of whether an exception was raised or caught.",
      keywords: ['try', 'except', 'exception', 'finally', 'error', 'raise', 'cleanup']
    },
    {
      question: "What is the difference between *args and **kwargs in Python function definitions?",
      idealAnswer: "*args allows a function to accept any number of positional arguments (collected into a tuple). **kwargs allows a function to accept any number of keyword/named arguments (collected into a dictionary).",
      keywords: ['args', 'kwargs', 'positional', 'keyword', 'tuple', 'dictionary', 'argument']
    },
    {
      question: "What is the GIL (Global Interpreter Lock) in Python, and how does it affect multi-threading?",
      idealAnswer: "The GIL is a mutex in CPython that prevents multiple native threads from executing Python bytecodes at once. This makes multi-threading in Python unable to utilize multiple CPU cores for CPU-bound tasks, requiring multi-processing instead.",
      keywords: ['gil', 'lock', 'thread', 'multi-threading', 'cpu', 'core', 'mutex', 'interpreter']
    }
  ],
  'general': [
    {
      question: "What is your understanding of RESTful API design principles, and how do you structure your endpoints?",
      idealAnswer: "RESTful principles model resources as nouns (e.g. /users) and use HTTP verbs for actions (GET to retrieve, POST to create, PUT/PATCH to edit, DELETE to delete). REST APIs are stateless, separating client and server concerns, and return standard status codes (e.g., 200 OK, 201 Created, 404 Not Found, 500 Server Error) and standard payloads.",
      keywords: ['stateless', 'verb', 'get', 'post', 'put', 'delete', 'endpoint', 'resource']
    },
    {
      question: "Could you explain the difference between SQL and NoSQL databases, and when to choose which?",
      idealAnswer: "SQL databases are relational, use tables/schemas, support complex JOINs, and enforce ACID properties (ideal for structured transactions, finance). NoSQL databases are non-relational (document, key-value, graph), have dynamic schemas, scale horizontally, and are ideal for unstructured big data, real-time analytics, and rapid development.",
      keywords: ['schema', 'relational', 'table', 'document', 'join', 'scale', 'nosql']
    },
    {
      question: "What is Git branching strategy, and how do you handle merge conflicts in a team?",
      idealAnswer: "Branching strategies (like GitFlow, GitHub Flow) organize development using feature branches merged into a main or develop branch via Pull Requests. To resolve merge conflicts: pull the latest target branch locally, merge it into your feature branch, resolve conflicting lines manually in code, stage, commit, and push the resolved code.",
      keywords: ['merge', 'conflict', 'branch', 'rebase', 'git', 'pr', 'pull', 'commit']
    },
    {
      question: "How do you approach writing clean, testable code, and what is your view on Unit Testing?",
      idealAnswer: "Clean code adheres to SOLID principles, DRY (Don't Repeat Yourself), and utilizes small, single-responsibility functions. Testable code avoids tight coupling and global state. Unit testing verifies isolated blocks (functions or classes) in mock environments, ensuring long-term code stability and fast bug detection during refactoring.",
      keywords: ['test', 'clean', 'read', 'dry', 'solid', 'isolated', 'mock']
    },
    {
      question: "Can you describe a challenging technical problem you solved recently and your approach?",
      idealAnswer: "Candidates should describe a complex technical issue (like performance bottlenecks, race conditions, memory leaks) and their analytical troubleshooting steps: isolating the bug using profiling/logging tools, researching options, applying a clean fix, and writing automated tests to prevent regression.",
      keywords: ['solved', 'debug', 'error', 'challenge', 'approach', 'fix']
    },
    {
      question: "What is the difference between HTTP and HTTPS, and how does HTTPS encrypt communications?",
      idealAnswer: "HTTP sends data in plain text, making it vulnerable to interception. HTTPS encrypts data using SSL/TLS protocols. It uses asymmetric encryption (public/private keys) to establish a secure session key, and symmetric encryption for actual data transfer.",
      keywords: ['http', 'https', 'encrypt', 'ssl', 'tls', 'secure', 'certificate', 'private']
    },
    {
      question: "What is the difference between authentication and authorization in system security?",
      idealAnswer: "Authentication verifies *who* the user is (e.g. login credentials, MFA, biometric checks). Authorization determines *what* permissions the authenticated user has (e.g. read access, admin roles, API rate limits).",
      keywords: ['authentication', 'authorization', 'permission', 'identity', 'role', 'login']
    },
    {
      question: "What are the core concepts of Object-Oriented Programming (OOP)?",
      idealAnswer: "The four pillars of OOP are: 1) Encapsulation (hiding internal state/details), 2) Inheritance (sharing properties/methods between classes), 3) Polymorphism (overriding methods in subclasses), and 4) Abstraction (hiding complexity behind interfaces).",
      keywords: ['pillar', 'oop', 'encapsulation', 'inheritance', 'polymorphism', 'abstraction']
    },
    {
      question: "What a RESTful API vs GraphQL, and when would you use GraphQL?",
      idealAnswer: "RESTful APIs expose resources via separate endpoints (GET /users, GET /posts), which can lead to over-fetching. GraphQL uses a single endpoint where clients request exactly the fields they need in a query schema, making it ideal for mobile apps or complex nested data.",
      keywords: ['rest', 'graphql', 'endpoint', 'query', 'schema', 'over-fetching', 'field']
    },
    {
      question: "What is the purpose of Docker and containerization in modern deployment?",
      idealAnswer: "Docker packages an application and all its dependencies, system libraries, and configs into a lightweight container. This ensures that the application runs identically in any environment (local, testing, cloud), eliminating configuration differences.",
      keywords: ['docker', 'container', 'environment', 'dependency', 'deploy', 'isolated', 'package']
    }
  ]
};

// Helper: Get matching mock questions based on topic search
function getMockQuestionsForTopic(topic = '') {
  const cleanTopic = topic.toLowerCase().trim();
  if (cleanTopic.includes('react')) return MOCK_DATA.react;
  if (cleanTopic.includes('node')) return MOCK_DATA.node;
  if (cleanTopic.includes('javascript') || cleanTopic.includes('js')) return MOCK_DATA.javascript;
  if (cleanTopic.includes('python')) return MOCK_DATA.python;
  return MOCK_DATA.general;
}

// Helper: Check if two questions are near-identical duplicates (avoids blocking natural interrelated follow-ups)
function isSimilarQuestion(q1, q2) {
  if (!q1 || !q2) return false;
  
  // Follow-up transitions explicitly indicate contextual continuity - never mark as duplicates!
  const followUpTransitions = [
    'building on', 'you mentioned', 'following up', 'as you noted',
    'you touched on', 'earlier you', 'in your explanation', 'taking that further',
    'you highlighted', 'connecting back'
  ];
  const lowerQ1 = q1.toLowerCase();
  if (followUpTransitions.some(t => lowerQ1.includes(t))) {
    return false;
  }

  // Strip common recruiter greetings/preambles so we only compare the core question content
  const cleanQ = (q) => {
    return q
      .replace(/Hello\s+[A-Za-z0-9\s]+,\s*thank\s+you\s+for\s+joining\s+today's\s+session\..*Let's\s+start\s+with\s+our\s+first\s+question\./gi, '')
      .replace(/Hello\s+[A-Za-z0-9\s]+,\s*let's\s+start\..*first\s+question:/gi, '')
      .replace(/Let's\s+start\s+with\s+our\s+first\s+question\./gi, '')
      .replace(/Here\s+is\s+your\s+first\s+question:/gi, '')
      .replace(/First\s+question:/gi, '')
      .replace(/Next\s+question:/gi, '')
      .replace(/Question\s+\d+:/gi, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  };

  const clean1 = cleanQ(q1);
  const clean2 = cleanQ(q2);

  if (clean1 === clean2) return true;

  // Word overlap comparison
  const words1 = clean1.split(/\s+/).filter(w => w.length > 3);
  const words2 = clean2.split(/\s+/).filter(w => w.length > 3);

  if (words1.length === 0 || words2.length === 0) return false;

  const set2 = new Set(words2);
  let overlap = 0;
  words1.forEach(w => {
    if (set2.has(w)) overlap++;
  });

  // Only flag if >= 85% of words are identical to prevent blocking interrelated questions
  const similarity = overlap / Math.max(words1.length, words2.length);
  return similarity > 0.85;
}

// Senior AI/ML Context Engine: Adaptive Follow-Up Generator (Guarantees interrelation even on fallback)
function generateContextualFollowUp(candidateAnswer, topic, difficulty, historyList = [], nextIndex = 1, total = 5, isPreviousTurnCounter = false) {
  const ans = (candidateAnswer || '').toLowerCase().trim();
  const askedQuestions = (historyList || []).map(h => (h.question || '').toLowerCase());

  // Check if candidate answer expresses doubt, hesitation, or is very brief, and has NOT yet been countered
  const doubtKeywords = ['maybe', 'guess', 'think', 'not sure', 'probably', 'dont know', "don't know", 'uncertain', 'possibly', 'i suppose', 'not certain'];
  const hasDoubt = doubtKeywords.some(dk => ans.includes(dk)) || (ans.length > 0 && ans.split(/\s+/).length < 8);

  if (!isPreviousTurnCounter && hasDoubt && ans.length > 0 && !['skip', 'pass'].includes(ans)) {
    return {
      question: `You touched on that concept, but there seemed to be slight hesitation or ambiguity in your explanation. To assure a fair and complete knowledge analysis, could you specifically clarify the underlying mechanics and how failure or edge-case scenarios are handled?`,
      feedback: "Please clarify your explanation to resolve technical ambiguity and demonstrate depth.",
      emotion: 'thinking',
      isCounterQuestion: true,
      doubtReason: "Candidate response showed hesitation or brief elaboration on core runtime mechanics.",
      skillDomain: "Core Concepts & Edge Cases"
    };
  }

  // Technical concept probes mapped to candidate answer keywords
  const conceptProbes = [
    {
      keywords: ['usestate', 'useeffect', 'usememo', 'usecallback', 'hook', 'hooks', 'lifecycle'],
      question: "You mentioned React hooks and component lifecycle behavior. Following up on that, how do you prevent stale closures in custom hooks, and what specific techniques do you use to avoid unnecessary re-renders in deeply nested components?",
      feedback: "Good grasp of React state and hook lifecycle mechanics.",
      skillDomain: "React Lifecycle & State Architecture"
    },
    {
      keywords: ['redux', 'zustand', 'context', 'store', 'reducer', 'dispatch', 'action', 'state management'],
      question: "Building on your points about state management, how do you separate server-side cache state from client UI state, and how do you prevent selector re-render cascades across your components?",
      feedback: "Solid understanding of front-end state architecture.",
      skillDomain: "State Architecture & Store Management"
    },
    {
      keywords: ['async', 'await', 'promise', 'callback', 'event loop', 'microtask', 'macrotask', 'then', 'catch'],
      question: "You touched on asynchronous execution and promises. Taking that further, how does the JavaScript event loop prioritize microtasks over macrotasks, and how do you handle race conditions when concurrent in-flight requests resolve out of order?",
      feedback: "Strong explanation of asynchronous JavaScript workflows.",
      skillDomain: "Asynchronous Concurrency & Event Loop"
    },
    {
      keywords: ['closure', 'scope', 'hoisting', 'lexical', 'var', 'let', 'const', 'temporal dead zone'],
      question: "Connecting back to your explanation of lexical scoping and closures, what are the common memory leak risks associated with retaining closures in long-lived event listeners, and how do you prevent them?",
      feedback: "Clear breakdown of JavaScript scope and variable lifecycle.",
      skillDomain: "Scope, Closures & Memory Management"
    },
    {
      keywords: ['stream', 'buffer', 'pipe', 'backpressure', 'chunk', 'read', 'write', 'events'],
      question: "You noted stream processing and data buffers. In high-throughput Node.js microservices, how do you monitor and resolve backpressure bottlenecks between fast producers and slow consumers?",
      feedback: "Good insight into low-level stream and buffer mechanics.",
      skillDomain: "Stream Pipelines & Backpressure"
    },
    {
      keywords: ['decorator', 'generator', 'yield', 'lazy', 'iterator', 'iterable'],
      question: "Building on your explanation of generators and iteration, how do generators differ from asynchronous coroutines in Python, and how would you use them for memory-efficient big-data streaming pipelines?",
      feedback: "Insightful breakdown of Python iteration and generator patterns.",
      skillDomain: "Iterators, Generators & Lazy Evaluation"
    },
    {
      keywords: ['gil', 'thread', 'process', 'multiprocessing', 'concurrency', 'cpu', 'lock', 'mutex'],
      question: "Following up on your concurrency remarks, how does Python's Global Interpreter Lock (GIL) influence multi-core CPU scaling, and when should an engineer choose multiprocessing over asyncio or threading?",
      feedback: "Strong comprehension of Python runtime concurrency trade-offs.",
      skillDomain: "Concurrency & Process Architecture"
    },
    {
      keywords: ['sql', 'nosql', 'index', 'b-tree', 'query', 'join', 'schema', 'table', 'acid', 'transaction', 'shard'],
      question: "Regarding your database persistence points, how do composite B-Tree indexes work under the hood, and what are the operational trade-offs between write amplification and query latency in sharded tables?",
      feedback: "Solid architectural perspective on data persistence and indexing.",
      skillDomain: "Data Modeling, Indexing & Sharding"
    },
    {
      keywords: ['cache', 'redis', 'memcached', 'ttl', 'invalidation', 'stampede', 'hit', 'lru'],
      question: "You highlighted caching layers. In distributed production systems, how do you protect against cache stampedes (thundering herd problem) and maintain eventual consistency during write operations?",
      feedback: "Good understanding of distributed caching strategies.",
      skillDomain: "Distributed Caching & Invalidation"
    },
    {
      keywords: ['api', 'rest', 'graphql', 'endpoint', 'http', 'status', 'header', 'payload', 'idempotent'],
      question: "Building on your API design thoughts, how do you implement idempotent retry mechanisms with unique idempotency keys, and how do you handle graceful rate-limiting in production services?",
      feedback: "Thorough approach to resilient API system design.",
      skillDomain: "API Design & Resilient Systems"
    },
    {
      keywords: ['security', 'jwt', 'auth', 'token', 'cors', 'xss', 'csrf', 'cookie', 'session'],
      question: "You touched on security and authentication. What are the key architectural trade-offs in storing authentication tokens in HttpOnly Secure cookies versus browser storage to mitigate XSS and CSRF attack vectors?",
      feedback: "Sharp security awareness regarding authentication mechanisms.",
      skillDomain: "Security Architecture & Auth Vectors"
    },
    {
      keywords: ['docker', 'container', 'kubernetes', 'cluster', 'ci/cd', 'deploy', 'scale', 'pod'],
      question: "Connecting with your deployment perspective, how do you configure container liveness and readiness health probes in Kubernetes to guarantee zero-downtime rolling deployments?",
      feedback: "Practical knowledge of container orchestration and resilience.",
      skillDomain: "Container Orchestration & DevOps"
    }
  ];

  // 1. Try to find a concept probe matching words the candidate used
  for (const probe of conceptProbes) {
    const matched = probe.keywords.some(kw => ans.includes(kw));
    const alreadyAsked = askedQuestions.some(asked => asked.includes(probe.keywords[0]));
    if (matched && !alreadyAsked) {
      return {
        question: probe.question,
        feedback: probe.feedback,
        emotion: 'curious',
        isCounterQuestion: false,
        doubtReason: null,
        skillDomain: probe.skillDomain || "Core Technical Competency"
      };
    }
  }

  // 2. Dynamic contextual probe using candidate's actual terminology
  const words = ans.split(/\s+/).filter(w => w.length > 4 && !['about', 'which', 'their', 'there', 'because', 'would', 'could', 'should'].includes(w));
  const keyword = words.length > 0 ? words[Math.floor(Math.random() * words.length)] : topic;

  const dynamicContextualProbes = [
    `In your previous response, you highlighted your approach to "${keyword}". Taking that a step further, what are the critical production failure modes, concurrency issues, or edge cases you would monitor for in high-scale environments?`,
    `Building directly on what you just shared regarding "${keyword}", how would you test, benchmark, and monitor this implementation to guarantee high reliability and low latency under peak load?`,
    `You touched on key architectural principles around "${keyword}". If user requirements demanded horizontal distributed scaling across multiple regions, how would you evolve your technical design?`,
    `Following up on your answer about "${keyword}", how would you weigh the trade-offs of this solution versus alternative industry patterns for ${topic}?`
  ];

  for (const q of dynamicContextualProbes) {
    if (!askedQuestions.some(asked => asked.includes(q.substring(0, 35).toLowerCase()))) {
      return {
        question: q,
        feedback: "Constructive response. Let's explore the operational implications in greater depth.",
        emotion: 'thinking',
        isCounterQuestion: false,
        doubtReason: null,
        skillDomain: "Operational Scalability & Architecture"
      };
    }
  }

  // 3. Ultimate Fallback
  return {
    question: `Building on your explanation, how would you architect this solution to handle unexpected spikes in concurrency while preserving data integrity?`,
    feedback: "Good response. Let's delve deeper into production scalability.",
    emotion: 'curious',
    isCounterQuestion: false,
    doubtReason: null,
    skillDomain: "Concurrency & Data Integrity"
  };
}

// Helper: Get a random question in the category that is not similar to anything in history
function getNonDuplicateQuestion(category, historyList) {
  const questions = MOCK_DATA[category] || MOCK_DATA.general;
  const askedQuestions = (historyList || []).map(h => h.question);
  
  // Filter questions that are not similar to any asked question
  const remaining = questions.filter(q => {
    return !askedQuestions.some(asked => isSimilarQuestion(q.question, asked));
  });
  
  if (remaining.length > 0) {
    return remaining[Math.floor(Math.random() * remaining.length)];
  }
  
  const generalQuestions = MOCK_DATA.general;
  const remainingGeneral = generalQuestions.filter(q => {
    return !askedQuestions.some(asked => isSimilarQuestion(q.question, asked));
  });
  if (remainingGeneral.length > 0) {
    return remainingGeneral[Math.floor(Math.random() * remainingGeneral.length)];
  }
  
  return questions[Math.floor(Math.random() * questions.length)];
}


const MOCK_CODING_QUESTIONS = {
  'javascript': [
    {
      title: "Reverse a String",
      description: "Write a function `reverseString(str)` that takes a string as input and returns it reversed. For example, `reverseString('hello')` should return `'olleh'`.",
      template: "function reverseString(str) {\n  // Write your code here\n  \n}",
      functionName: "reverseString",
      testCases: [
        { input: "'hello'", expectedOutput: "'olleh'" },
        { input: "'React'", expectedOutput: "'tcaeR'" },
        { input: "'a'", expectedOutput: "'a'" }
      ]
    },
    {
      title: "Find Maximum Element",
      description: "Write a function `findMax(arr)` that takes an array of numbers and returns the largest number. For example, `findMax([1, 5, 3, 9, 2])` should return `9`.",
      template: "function findMax(arr) {\n  // Write your code here\n  \n}",
      functionName: "findMax",
      testCases: [
        { input: "[1, 5, 3, 9, 2]", expectedOutput: "9" },
        { input: "[-10, -5, -20]", expectedOutput: "-5" },
        { input: "[42]", expectedOutput: "42" }
      ]
    }
  ],
  'react': [
    {
      title: "Virtual DOM HTML Renderer",
      description: "Write a function `renderVirtualDOM(vnode)` that takes a virtual DOM node object and converts it to an HTML string. A vnode has the structure: `{ type: 'div', props: { id: 'app', className: 'box' }, children: ['Hello'] }`. For `className`, render it as `class` attribute in the HTML. For example, `renderVirtualDOM({ type: 'span', props: { className: 'text' }, children: ['React'] })` should return `'<span class=\"text\">React</span>'`. If children contain text, render the text directly; if children contain another node, recursively render it.",
      template: "function renderVirtualDOM(vnode) {\n  // Write your code here\n  \n}",
      functionName: "renderVirtualDOM",
      testCases: [
        { input: "{ type: 'span', props: { className: 'text' }, children: ['React'] }", expectedOutput: "'<span class=\"text\">React</span>'" },
        { input: "{ type: 'div', props: { id: 'app' }, children: [] }", expectedOutput: "'<div id=\"app\"></div>'" },
        { input: "'Plain Text'", expectedOutput: "'Plain Text'" }
      ]
    },
    {
      title: "React classNames Builder",
      description: "Write a function `classNames(...args)` that joins class names dynamically. It should accept strings, arrays of strings, and objects where keys are class names and values are boolean expressions. For example, `classNames('btn', { 'btn-active': true, 'btn-disabled': false }, ['btn-large'])` should return `'btn btn-active btn-large'`.",
      template: "function classNames(...args) {\n  // Write your code here\n  \n}",
      functionName: "classNames",
      testCases: [
        { input: "'btn', { 'btn-active': true, 'btn-disabled': false }, ['btn-large']", expectedOutput: "'btn btn-active btn-large'" },
        { input: "'header', null, undefined, { 'show': true }", expectedOutput: "'header show'" },
        { input: "['a', ['b', { 'c': true }]]", expectedOutput: "'a b c'" }
      ]
    }
  ],
  'node': [
    {
      title: "Format Query String",
      description: "Write a function `parseQueryParams(url)` that extracts query parameters from a URL and returns them as a key-value object. For example, `parseQueryParams('https://example.com?page=2&limit=10')` should return `{\"page\":\"2\",\"limit\":\"10\"}`.",
      template: "function parseQueryParams(url) {\n  // Write your code here\n  \n}",
      functionName: "parseQueryParams",
      testCases: [
        { input: "'https://example.com?name=john&age=30'", expectedOutput: '{"name":"john","age":"30"}' },
        { input: "'https://test.io?search=react'", expectedOutput: '{"search":"react"}' },
        { input: "'https://api.com'", expectedOutput: '{}' }
      ]
    },
    {
      title: "Sum Digits of Number",
      description: "Write a function `sumDigits(n)` that takes a positive integer and returns the sum of its digits. For example, `sumDigits(123)` should return `6`.",
      template: "function sumDigits(n) {\n  // Write your code here\n  \n}",
      functionName: "sumDigits",
      testCases: [
        { input: "123", expectedOutput: "6" },
        { input: "909", expectedOutput: "18" },
        { input: "5", expectedOutput: "5" }
      ]
    }
  ],
  'python': [
    {
      title: "Palindrome Check",
      description: "Write a Python function `is_palindrome(s)` that checks if a given string is a palindrome (reads the same backward as forward, ignoring case). For example, `is_palindrome('racecar')` should return `True`.",
      template: "def is_palindrome(s):\n    # Write your code here\n    pass",
      functionName: "is_palindrome",
      testCases: [
        { input: "'racecar'", expectedOutput: "True" },
        { input: "'hello'", expectedOutput: "False" },
        { input: "'Madam'", expectedOutput: "True" }
      ]
    },
    {
      title: "Find Even Numbers",
      description: "Write a Python function `get_evens(nums)` that takes a list of integers and returns a list containing only the even numbers. For example, `get_evens([1, 2, 3, 4])` should return `[2, 4]`.",
      template: "def get_evens(nums):\n    # Write your code here\n    pass",
      functionName: "get_evens",
      testCases: [
        { input: "[1, 2, 3, 4]", expectedOutput: "[2, 4]" },
        { input: "[1, 3, 5]", expectedOutput: "[]" },
        { input: "[0, -2, -3]", expectedOutput: "[0, -2]" }
      ]
    }
  ],
  'general': [
    {
      title: "Two Sum Indices",
      description: "Write a function `twoSum(nums, target)` that finds two numbers in the array `nums` that add up to `target`, and returns their indices as an array. For example, `twoSum([2, 7, 11, 15], 9)` should return `[0, 1]`.",
      template: "function twoSum(nums, target) {\n  // Write your code here\n  \n}",
      functionName: "twoSum",
      testCases: [
        { input: "[2, 7, 11, 15], 9", expectedOutput: "[0, 1]" },
        { input: "[3, 2, 4], 6", expectedOutput: "[1, 2]" },
        { input: "[3, 3], 6", expectedOutput: "[0, 1]" }
      ]
    },
    {
      title: "Fibonacci Number",
      description: "Write a function `fibonacci(n)` that returns the nth Fibonacci number (where F(0) = 0, F(1) = 1, F(2) = 1, F(3) = 2, etc.). For example, `fibonacci(6)` should return `8`.",
      template: "function fibonacci(n) {\n  // Write your code here\n  \n}",
      functionName: "fibonacci",
      testCases: [
        { input: "6", expectedOutput: "8" },
        { input: "0", expectedOutput: "0" },
        { input: "1", expectedOutput: "1" }
      ]
    }
  ]
};

function getMockCodingQuestionForTopic(topic = '') {
  const cleanTopic = topic.toLowerCase().trim();
  
  // React is not supported as a runnable live coding environment. Skip!
  if (cleanTopic.includes('react')) {
    return null;
  }
  
  const hasJS = cleanTopic.includes('javascript') || cleanTopic.includes('js') || cleanTopic.includes('node');
  const hasPython = cleanTopic.includes('python');
  
  if (!hasJS && !hasPython) {
    return null;
  }

  let list = MOCK_CODING_QUESTIONS.general;
  if (cleanTopic.includes('node')) list = MOCK_CODING_QUESTIONS.node;
  else if (cleanTopic.includes('javascript') || cleanTopic.includes('js')) list = MOCK_CODING_QUESTIONS.javascript;
  else if (cleanTopic.includes('python')) list = MOCK_CODING_QUESTIONS.python;
  
  // Pick a random question from list
  return list[Math.floor(Math.random() * list.length)];
}

// Helper: Call Groq API using native fetch (OpenAI-compatible) with fallback models, multi-turn messages, and keys support
async function callGroq(promptOrMessages, clientApiKey = null, systemPrompt = null) {
  const primaryKey = clientApiKey || process.env.GROQ_API_KEY;
  const secondaryKey = process.env.SECONDARY_GROQ_API_KEY;

  const keysToTry = [];
  if (primaryKey) {
    keysToTry.push({ key: primaryKey, label: "primary" });
  }
  if (secondaryKey && secondaryKey !== primaryKey) {
    keysToTry.push({ key: secondaryKey, label: "secondary fallback" });
  }

  if (keysToTry.length === 0) {
    throw new Error("GROQ_API_KEY not configured");
  }

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  
  let messages = [];
  if (Array.isArray(promptOrMessages)) {
    messages = [...promptOrMessages];
    if (systemPrompt && (!messages[0] || messages[0].role !== 'system')) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }
  } else {
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: promptOrMessages });
  }

  // Define fallback hierarchy
  const primaryModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const fallbackModels = [
    primaryModel,
    "llama-3.1-8b-instant",
    "llama-3.1-70b-versatile",
    "llama3-8b-8192",
    "llama3-70b-8192"
  ];
  // Deduplicate and maintain order
  const modelsToTry = Array.from(new Set(fallbackModels));

  let lastError = null;

  for (const keyObj of keysToTry) {
    const activeKey = keyObj.key;
    console.log(`[Groq API] Attempting call using ${keyObj.label} API Key`);

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      console.log(`[Groq API] Attempting call with model: "${currentModel}" (Attempt ${i + 1}/${modelsToTry.length})`);
      
      const requestBody = {
        model: currentModel,
        messages,
        response_format: {
          type: "json_object"
        },
        temperature: 0.7
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${activeKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Status ${response.status}: ${errText}`);
        }

        const data = await response.json();
        const responseText = data.choices?.[0]?.message?.content;
        if (!responseText) {
          throw new Error("Received empty message content response");
        }

        const parsedJSON = JSON.parse(responseText.trim());
        console.log(`[Groq API] Success using ${keyObj.label} API Key and model "${currentModel}"`);
        return parsedJSON;
      } catch (error) {
        console.warn(`[Groq API] Warning: ${keyObj.label} API Key with model "${currentModel}" failed. Error: ${error.message}`);
        lastError = error;

        // If it's a authorization error or invalid key, skip remaining models for this key
        if (error.message.includes("Status 401") || error.message.includes("Status 403")) {
          console.warn(`[Groq API] Auth/Access error. Skipping remaining models for this key.`);
          break;
        }
      }
    }
  }

  console.error("[Groq API] Error: All candidate models and keys failed.");
  throw lastError || new Error("All Groq model attempts failed.");
}

// Helper: Generate fallback starting questions list and coding challenges
function generateFallbackStart(name, topic, difficulty, numQuestions, resumeText) {
  const hasResume = !!resumeText;
  const targetNum = hasResume ? 8 : (parseInt(numQuestions) || 5);
  
  let questionsList = [];
  let codingQuestions = [];

  if (hasResume) {
    // Find skills in resume text
    const cleanResume = resumeText.toLowerCase();
    const detectedTopics = [];
    if (cleanResume.includes('react')) detectedTopics.push('react');
    if (cleanResume.includes('node')) detectedTopics.push('node');
    if (cleanResume.includes('python')) detectedTopics.push('python');
    if (cleanResume.includes('javascript') || cleanResume.includes('js')) detectedTopics.push('javascript');

    if (detectedTopics.length === 0) {
      detectedTopics.push('general');
    }

    // Collect mock questions
    let pooledQuestions = [];
    detectedTopics.forEach(t => {
      pooledQuestions = pooledQuestions.concat(MOCK_DATA[t] || []);
    });
    // Fill with general if not enough
    if (pooledQuestions.length < 8) {
      pooledQuestions = pooledQuestions.concat(MOCK_DATA.general || []);
    }

    // Select 8 unique questions
    const selectedQuestions = [];
    const usedIndices = new Set();
    while (selectedQuestions.length < 8 && usedIndices.size < pooledQuestions.length) {
      const randIdx = Math.floor(Math.random() * pooledQuestions.length);
      if (!usedIndices.has(randIdx)) {
        usedIndices.add(randIdx);
        selectedQuestions.push(pooledQuestions[randIdx]);
      }
    }
    questionsList = selectedQuestions;

    // Select 3 coding questions with different languages if present
    const hasPython = cleanResume.includes('python');
    const hasJS = cleanResume.includes('javascript') || cleanResume.includes('js');

    if (!hasPython && !hasJS) {
      codingQuestions = [];
    } else {
      let pythonList = MOCK_CODING_QUESTIONS.python || [];
      let jsList = (MOCK_CODING_QUESTIONS.javascript || []).concat(MOCK_CODING_QUESTIONS.react || []).concat(MOCK_CODING_QUESTIONS.node || []);

      if (hasPython && hasJS) {
        // Pick 1 Python, 2 JS
        const pQ = pythonList[Math.floor(Math.random() * pythonList.length)];
        const jQ1 = jsList[Math.floor(Math.random() * jsList.length)];
        let jQ2 = jsList[Math.floor(Math.random() * jsList.length)];
        while (jQ2 === jQ1 && jsList.length > 1) {
          jQ2 = jsList[Math.floor(Math.random() * jsList.length)];
        }
        
        codingQuestions.push({ ...pQ, language: 'python' });
        codingQuestions.push({ ...jQ1, language: 'javascript' });
        codingQuestions.push({ ...jQ2, language: 'javascript' });
      } else if (hasPython) {
        // Pick 3 Python (fallback to general/duplicates)
        const pQ1 = pythonList[Math.floor(Math.random() * pythonList.length)];
        let pQ2 = pythonList[Math.floor(Math.random() * pythonList.length)];
        if (pythonList.length > 1 && pQ2 === pQ1) {
          pQ2 = pythonList.find(q => q !== pQ1);
        }
        const genList = MOCK_CODING_QUESTIONS.general || [];
        const gQ = genList[Math.floor(Math.random() * genList.length)];
        
        codingQuestions.push({ ...pQ1, language: 'python' });
        codingQuestions.push({ ...pQ2, language: 'python' });
        codingQuestions.push({ ...gQ, language: 'javascript' });
      } else {
        // Pick 3 JS
        const jQ1 = jsList[Math.floor(jsList.length > 0 ? Math.random() * jsList.length : 0)];
        let jQ2 = jsList[Math.floor(jsList.length > 0 ? Math.random() * jsList.length : 0)];
        while (jQ2 === jQ1 && jsList.length > 1) {
          jQ2 = jsList[Math.floor(Math.random() * jsList.length)];
        }
        const genList = MOCK_CODING_QUESTIONS.general || [];
        const gQ = genList[Math.floor(Math.random() * genList.length)];

        if (jQ1) codingQuestions.push({ ...jQ1, language: 'javascript' });
        if (jQ2) codingQuestions.push({ ...jQ2, language: 'javascript' });
        if (gQ) codingQuestions.push({ ...gQ, language: 'javascript' });
      }
    }
  } else {
    const questions = getMockQuestionsForTopic(topic);
    // Pick targetNum random questions
    const selected = [];
    const indices = new Set();
    while (selected.length < targetNum && indices.size < questions.length) {
      const randIdx = Math.floor(Math.random() * questions.length);
      if (!indices.has(randIdx)) {
        indices.add(randIdx);
        selected.push(questions[randIdx]);
      }
    }
    questionsList = selected;

    const singleCoding = getMockCodingQuestionForTopic(topic);
    codingQuestions = singleCoding ? [singleCoding] : [];
  }

  return {
    questionsList,
    codingQuestions
  };
}

// Master LLM Router: Prioritizes Gemini 2.5 Flash via Vertex AI (ADC Auth) / Google GenAI,
// and gracefully falls back to Groq Llama 3.3.
async function callPrimaryLLM(promptOrMessages, options = {}) {
  const { systemPrompt, groqApiKey } = options;

  // 1. Primary: Gemini 2.5 Flash via Vertex AI (ADC Auth) / Google GenAI
  try {
    console.log(`[LLM Router] Routing request to Gemini 2.5 Flash (ADC Auth)...`);
    const geminiResult = await callGemini25Flash(promptOrMessages, {
      systemPrompt,
      apiKey: process.env.GEMINI_API_KEY
    });
    console.log(`[LLM Router] Successfully obtained response from Gemini 2.5 Flash.`);
    return { ...geminiResult, modelUsed: 'gemini-2.5-flash' };
  } catch (geminiErr) {
    console.warn(`[LLM Router] Gemini 2.5 Flash note: ${geminiErr.message}. Attempting secondary Groq fallback...`);

    // 2. Secondary fallback: Groq API
    const activeGroqKey = groqApiKey || process.env.GROQ_API_KEY || SECONDARY_GROQ_API_KEY;
    if (activeGroqKey) {
      console.log(`[LLM Router] Routing to secondary Groq fallback...`);
      const groqResult = await callGroq(promptOrMessages, activeGroqKey, systemPrompt);
      return { ...groqResult, modelUsed: 'groq-llama' };
    }

    throw geminiErr;
  }
}

// Language Directive Helper for LLM Prompting
function getLanguageInstruction(selectedLang) {
  if (!selectedLang) {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: Conduct the interview in English (Indian / Global accent). Tolerate candidate English nuances and technical terminology seamlessly.',
      greeting: (name) => `Hello ${name}, thank you for joining today's session.`
    };
  }

  const l = selectedLang.toLowerCase().trim();
  if (l === 'hi-in' || l === 'hindi' || l === 'hi') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is HINDI (हिन्दी). You MUST present the greeting, ALL technical questions, follow-ups, and feedback strictly in professional Hindi (Devanagari script), explaining technical terms contextually.',
      greeting: (name) => `नमस्ते ${name}, आज के सत्र में आपका स्वागत है।`
    };
  }
  if (l === 'hinglish') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is HINGLISH. You MUST communicate in natural tech Hinglish (conversational blend of Hindi and English as commonly used in Indian tech teams, e.g., "React me Virtual DOM ka primary advantage kya hota hai?"). Tolerate candidate Hinglish seamlessly.',
      greeting: (name) => `Hello ${name}, आज के सेशन में आपका स्वागत है!`
    };
  }
  if (l === 'es-es' || l === 'spanish' || l === 'es') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is SPANISH (Español). You MUST present the greeting, all questions, counter-probes, and technical feedback in professional Spanish.',
      greeting: (name) => `Hola ${name}, bienvenido a la sesión de hoy.`
    };
  }
  if (l === 'fr-fr' || l === 'french' || l === 'fr') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is FRENCH (Français). You MUST present the greeting, all questions, counter-probes, and technical feedback in professional French.',
      greeting: (name) => `Bonjour ${name}, bienvenue à la session d'aujourd'hui.`
    };
  }
  if (l === 'de-de' || l === 'german' || l === 'de') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is GERMAN (Deutsch). You MUST present the greeting, all questions, counter-probes, and technical feedback in professional German.',
      greeting: (name) => `Hallo ${name}, herzlich willkommen zur heutigen Sitzung.`
    };
  }
  if (l === 'ja-jp' || l === 'japanese' || l === 'ja') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: The interview language is JAPANESE (日本語). You MUST present the greeting, all questions, counter-probes, and technical feedback in polite Japanese (敬語).',
      greeting: (name) => `こんにちは ${name} さん、本日の面接へようこそ。`
    };
  }
  if (l === 'en-us' || l === 'en-gb' || l === 'english' || l === 'en') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: Conduct strictly in professional English.',
      greeting: (name) => `Hello ${name}, thank you for joining today's session.`
    };
  }
  if (l === 'en-in') {
    return {
      instruction: '\nCRITICAL LANGUAGE DIRECTIVE: Conduct in English (Indian / Global accent). Tolerate candidate Indian English nuances and occasional Hinglish technical terminology seamlessly without score deductions.',
      greeting: (name) => `Hello ${name}, thank you for joining today's session.`
    };
  }

  // Custom user defined language
  return {
    instruction: `\nCRITICAL LANGUAGE DIRECTIVE: The candidate has defined their preferred interview language as "${selectedLang}". You MUST conduct the interview, question phrasing, counter-questions, and technical critique in "${selectedLang}". If technical coding terms are standardly borrowed in English in "${selectedLang}", communicate naturally.`,
    greeting: (name) => `Hello ${name}, thank you for joining today's session.`
  };
}

// Endpoint 1: Start Interview
app.post('/api/start-interview', async (req, res) => {
  const { name, topic, difficulty, numQuestions, groqApiKey, resumeText, language, modality } = req.body || {};
  const nameVal = name || 'Candidate';
  const topicVal = topic || 'React Developer';
  const difficultyVal = difficulty || 'Mid-Level';
  const hasResume = !!resumeText;
  const targetNum = hasResume ? 8 : (parseInt(numQuestions) || 5);
  const activeKey = groqApiKey || process.env.GROQ_API_KEY || SECONDARY_GROQ_API_KEY;
  const selectedLang = language || 'en-IN';

  console.log(`Starting interview for ${nameVal} on topic "${topicVal}" (${difficultyVal}, ${targetNum} questions, lang: ${selectedLang}, resume: ${hasResume})`);

  // Language Directives for Gemini 2.5 Flash / Groq
  const langMeta = getLanguageInstruction(selectedLang);
  const langInstruction = langMeta.instruction;

  // Detect coding feasibility
  const cleanResume = (resumeText || '').toLowerCase();
  const hasResumePython = cleanResume.includes('python');
  const hasResumeJS = cleanResume.includes('javascript') || cleanResume.includes('js');
  
  const cleanTopic = topicVal.toLowerCase().trim();
  const hasTopicJS = cleanTopic.includes('javascript') || cleanTopic.includes('js') || cleanTopic.includes('node');
  const hasTopicPython = cleanTopic.includes('python');

  const isCodingPossible = hasResume ? (hasResumePython || hasResumeJS) : ((hasTopicJS || hasTopicPython) && !cleanTopic.includes('react'));

  // GROQ / GEMINI 2.5 FLASH MODE (WITH RESUME)
  if (hasResume) {
    const systemPrompt = `You are a professional senior technical recruiter taking a mock interview.
You must return your response in a clean JSON object containing "question", "emotion", and "codingQuestions" keys.
"emotion" should be one of: "smiling", "friendly", "curious", "professional".
"codingQuestions" must be an array of coding challenges.
If neither JavaScript (JS) nor Python is present/mentioned in the resume, "codingQuestions" MUST be an empty array [].
If coding challenges are generated, each coding challenge must contain:
- "title": A short title of the programming challenge.
- "description": A clear description of the programming challenge. The problem must be solvable in standard, plain language (JavaScript or Python).
- "template": Starter code template including function signature.
- "functionName": The exact name of the function to be invoked.
- "language": Either "javascript" or "python" (ensure you only generate challenges in languages mentioned in the resume).
- "testCases": An array of exactly 3 test cases. Each test case must be a JSON object containing "input" (parameters comma-separated, e.g. "[2, 7], 9" or "'hello'" or "1, 2") and "expectedOutput" (string representation of expected output, e.g. "9" or "'olleh'" or "True"/"False" for Python).${langInstruction}`;

    const prompt = `Candidate Name: ${nameVal}
Target Difficulty: ${difficultyVal}
Resume Text:
"""
${resumeText}
"""

This is the very beginning of the interview.
Tasks:
1. Parse the resume to identify the candidate's core technologies and languages (e.g. JavaScript, Python, C++, etc.).
2. You will ask a total of 8 theory questions in this interview. Welcome the candidate and present the FIRST technical question (1-2 sentences) checking a key skill from their resume.
3. Generate EXACTLY 3 coding challenges in different languages (specifically JavaScript and Python if both are mentioned/present in the resume) based on the resume skills. If neither is present, set codingQuestions to [].
4. Respond ONLY in this JSON format:
{
  "question": "Your greeting and first theory question.",
  "emotion": "smiling",
  "codingQuestions": [
    {
      "title": "Title 1",
      "description": "...",
      "template": "...",
      "functionName": "...",
      "language": "javascript",
      "testCases": [...]
    },
    ...
  ]
}`;

    try {
      const aiResponse = await callPrimaryLLM(prompt, { systemPrompt, groqApiKey: activeKey });
      let questionText = aiResponse.question || '';
      const lowerQ = questionText.toLowerCase().trim();
      if (!lowerQ.startsWith('hello') && !lowerQ.startsWith('hi') && !lowerQ.startsWith('welcome') && !lowerQ.startsWith('नमस्ते') && !lowerQ.startsWith('hola') && !lowerQ.startsWith('bonjour') && !lowerQ.startsWith('hallo') && !lowerQ.startsWith('こんにちは')) {
        const greetingPrefix = langMeta.greeting(nameVal);
        questionText = `${greetingPrefix} Let's start with our first question: ${questionText}`;
      }
      return res.json({
        question: questionText,
        emotion: aiResponse.emotion || 'smiling',
        isMock: false,
        modelUsed: aiResponse.modelUsed || 'gemini-2.5-flash',
        currentQuestionIndex: 0,
        totalQuestions: 8,
        codingQuestions: isCodingPossible ? (aiResponse.codingQuestions || []) : [],
        codingQuestion: isCodingPossible && aiResponse.codingQuestions && aiResponse.codingQuestions.length > 0 ? aiResponse.codingQuestions[0] : null
      });
    } catch (error) {
      console.warn("AI resume start failed, falling back to mock engine:", error.message);
      const fallbackData = generateFallbackStart(nameVal, topicVal, difficultyVal, targetNum, resumeText);
      const chosen = fallbackData.questionsList[0];
      return res.json({
        question: `Hello ${nameVal}, let's start. Here is your first question: ${chosen.question}`,
        emotion: 'smiling',
        isMock: true,
        currentQuestionIndex: 0,
        totalQuestions: 8,
        codingQuestions: isCodingPossible ? fallbackData.codingQuestions : [],
        codingQuestion: isCodingPossible ? fallbackData.codingQuestions[0] : null
      });
    }
  }

  // STANDARD MODE (NO RESUME)
  const isPython = topicVal.toLowerCase().includes('python');
  const codingLanguage = isPython ? 'Python' : 'JavaScript';
  const functionTemplateExample = isPython ? 'def name(...):\n    pass' : 'function name(...) {\n  // ...\n}';
  const expectedOutputExample = isPython ? '"True"' : '"[0,1]"';

  const systemPrompt = `You are a professional senior technical recruiter taking a mock interview.
You must return your response in a clean JSON object containing "question", "emotion", and "codingQuestion" keys.
"emotion" should be one of: "smiling", "friendly", "curious", "professional".
"codingQuestion" must be a JSON object containing:
- "title": A short title of the programming challenge.
- "description": A clear description of the programming challenge. The problem must be solvable in standard, plain ${codingLanguage} (without JSX or third-party web frameworks, as it will run directly in a headless browser/Pyodide sandbox).
- "template": Starter code template including function signature.
- "functionName": The exact name of the function to be invoked.
- "testCases": An array of exactly 3 test cases. Each test case must be a JSON object containing "input" (parameters comma-separated, e.g. "[2, 7], 9" or "'hello'" or "1, 2") and "expectedOutput" (string representation of expected output, e.g. ${expectedOutputExample} or ${isPython ? '"False"' : '"olleh"'});${langInstruction}`;

  const randomSeed = Math.random().toString(36).substring(7);
  const prompt = `Candidate Name: ${nameVal}
Role/Topic: ${difficultyVal} level expertise in "${topicVal}"
Total Questions to ask: ${targetNum}
Session ID / Random Seed: ${randomSeed}

This is the very beginning of the interview. You need to greet the candidate and ask the FIRST question.
Welcome the candidate briefly (1 sentence) and present the first technical question (1-2 sentences).
To prevent repetitive mock questions, you MUST generate a completely unique, specific technical question for the topic. Avoid generic standard questions unless they contain a unique twist.
Additionally, you must generate a ${codingLanguage} coding challenge suitable for a ${difficultyVal} level candidate on the topic of "${topicVal}".
Respond ONLY in this JSON format:
{
  "question": "Your greeting and the first theory question.",
  "emotion": "smiling",
  "codingQuestion": {
    "title": "Title",
    "description": "Description...",
    "template": "${functionTemplateExample}",
    "functionName": "name",
    "testCases": [
      { "input": "...", "expectedOutput": "..." }
    ]
  }
}`;

  try {
    const aiResponse = await callPrimaryLLM(prompt, { systemPrompt, groqApiKey: activeKey });
    let questionText = aiResponse.question || '';
    const lowerQ = questionText.toLowerCase().trim();
    if (!lowerQ.startsWith('hello') && !lowerQ.startsWith('hi') && !lowerQ.startsWith('welcome') && !lowerQ.startsWith('नमस्ते') && !lowerQ.startsWith('hola') && !lowerQ.startsWith('bonjour') && !lowerQ.startsWith('hallo') && !lowerQ.startsWith('こんにちは')) {
      const greetingPrefix = langMeta.greeting(nameVal);
      questionText = `${greetingPrefix} Let's start with our first question: ${questionText}`;
    }
    return res.json({
      question: questionText,
      emotion: aiResponse.emotion || 'smiling',
      isMock: false,
      modelUsed: aiResponse.modelUsed || 'gemini-2.5-flash',
      currentQuestionIndex: 0,
      totalQuestions: targetNum,
      codingQuestion: isCodingPossible ? aiResponse.codingQuestion : null
    });
  } catch (error) {
    console.warn("AI call failed on start-interview, falling back to mock engine:", error.message);
    const fallbackData = generateFallbackStart(nameVal, topicVal, difficultyVal, targetNum, resumeText);
    const chosen = fallbackData.questionsList[0];
    return res.json({
      question: `Hello ${nameVal}, let's start. Here is your first question: ${chosen.question}`,
      emotion: 'smiling',
      isMock: true,
      currentQuestionIndex: 0,
      totalQuestions: targetNum,
      codingQuestion: isCodingPossible ? fallbackData.codingQuestions[0] : null
    });
  }
});

// Endpoint 2: Submit Answer
app.post('/api/submit-answer', async (req, res) => {
  const { name, topic, difficulty, numQuestions, currentQuestionIndex, candidateAnswer, history, groqApiKey, language } = req.body;
  const currIdx = parseInt(currentQuestionIndex) || 0;
  const total = parseInt(numQuestions) || 5;
  const activeKey = groqApiKey || process.env.GROQ_API_KEY || SECONDARY_GROQ_API_KEY;
  const langMeta = getLanguageInstruction(language);

  console.log(`Submitting answer for question ${currIdx}/${total - 1} from ${name} (lang: ${language || 'en-IN'})`);

  const cleanTopic = topic.toLowerCase().trim();
  const category = cleanTopic.includes('react') ? 'react' :
                   cleanTopic.includes('node') ? 'node' :
                   (cleanTopic.includes('javascript') || cleanTopic.includes('js')) ? 'javascript' :
                   cleanTopic.includes('python') ? 'python' : 'general';

  // Check if the previous turn in history was already a counter-question probe
  const isPreviousTurnCounter = Array.isArray(history) && history.length > 0 && !!history[history.length - 1]?.isCounterQuestion;
  const nextIndex = currIdx + 1;
  const isFinalQuestion = nextIndex >= total && (isPreviousTurnCounter || !activeKey);

  if (!activeKey) {
    // CONTEXT-AWARE FALLBACK ENGINE (when API key is absent)
    const contextualObj = generateContextualFollowUp(candidateAnswer, topic, difficulty, history, nextIndex, total, isPreviousTurnCounter);
    const shouldCounter = !isPreviousTurnCounter && !!contextualObj.isCounterQuestion;
    const finalNextIndex = shouldCounter ? currIdx : nextIndex;
    const isComplete = !shouldCounter && finalNextIndex >= total;

    if (isComplete) {
      return res.json({
        feedback: "Thank you for completing the technical round. You provided solid insights across the discussed concepts.",
        question: "Thank you, that concludes our verbal technical assessment. I will now compile your comprehensive evaluation report.",
        emotion: 'friendly',
        isComplete: true,
        isCounterQuestion: false,
        doubtReason: null,
        skillDomain: contextualObj.skillDomain || "Core Technical Concepts",
        currentQuestionIndex: finalNextIndex
      });
    }

    return res.json({
      feedback: contextualObj.feedback,
      question: contextualObj.question,
      emotion: contextualObj.emotion || (shouldCounter ? 'thinking' : 'curious'),
      isComplete: false,
      isCounterQuestion: shouldCounter,
      doubtReason: shouldCounter ? (contextualObj.doubtReason || "Technical clarification requested") : null,
      skillDomain: contextualObj.skillDomain || "Core Technical Concepts",
      currentQuestionIndex: finalNextIndex
    });
  }

  // LLM CONVERSATIONAL CONTEXT WINDOW ENGINE
  // Build native multi-turn message sequence
  const conversationMessages = [
    {
      role: 'system',
      content: `You are a Principal Engineering Director and Senior Technical Interviewer conducting an interactive mock technical interview for ${name}.
Role / Seniority: ${difficulty} level in "${topic}".
Interview Language: ${language || 'en-IN'}${langMeta.instruction}

STRICT CONTEXT WINDOW & QUESTIONING DIRECTIVES:
1. MANDATORY CONVERSATIONAL INTERRELATION:
   - Every single question you ask MUST be directly interrelated with the candidate's previous response and conversation context window.
   - You MUST NOT ask disconnected, isolated textbook trivia questions.
   - Always demonstrate active listening by starting your question with a brief, natural conversational acknowledgement referencing a specific technical claim, architecture choice, or mechanism the candidate just mentioned (e.g., "You noted using X for Y...", "Building on your point regarding...", "In your explanation of...", "Given how you structured...").

2. RIGOROUS DOUBT COUNTERING & FAIR KNOWLEDGE ANALYSIS:
   - Carefully analyze the candidate's answer for technical ambiguity, hesitation (e.g., "maybe", "I guess", "probably", "I think"), superficial explanations, unverified claims, missing critical failure modes, or partial accuracy.
   - If there is DOUBT or AMBIGUITY in the candidate's response (and this specific question has not already received a counter-probe):
     * You MUST challenge that doubt with a targeted COUNTER-QUESTION in order to assure complete, fair knowledge analysis!
     * Set "isCounterQuestion": true
     * Set "doubtReason": 1 clear sentence describing the exact technical doubt or ambiguity detected.
     * In "question", formulate a sharp, constructive counter-question directly probing that doubtful point (e.g., "You mentioned X, but you seemed hesitant about Y—how would this behave under Z?", "You noted X, but how does that prevent race condition Y?").
     * Provide constructive guidance in "feedback".
     * Set "isComplete": false.
   - If the candidate's response is confident, thorough, and clear (OR if they have just clarified/answered a previous counter-question):
     * Set "isCounterQuestion": false.
     * Set "doubtReason": null.
     * Provide expert feedback in "feedback".
     * If nextIndex >= ${total}: Set "isComplete": true and provide a gracious closing remark in "question".
     * If not final: Set "isComplete": false and generate the next interrelated technical question probing architectural trade-offs, edge cases, or system design.

3. SKILL DOMAIN IDENTIFICATION:
   - Identify the competency skill domain associated with this question/answer (e.g., "Asynchronous Mechanics", "State Architecture", "Performance Optimization", "Error Resilience", etc.) and set in "skillDomain".

4. RESPONSE SCHEMA:
   Respond ONLY with a valid JSON object matching:
   {
     "feedback": "1-2 sentences of constructive, expert technical critique evaluating their specific answer.",
     "question": "Your next interrelated technical question OR targeted counter-question challenging a doubtful point.",
     "emotion": "smiling" | "curious" | "professional" | "thinking",
     "isCounterQuestion": boolean,
     "doubtReason": "Brief explanation of the specific doubt or ambiguity detected in their answer, or null if solid",
     "skillDomain": "Specific competency domain name (e.g. Asynchronous Mechanics)",
     "isComplete": boolean
   }`
    }
  ];

  // Reconstruct full multi-turn dialogue history
  if (Array.isArray(history)) {
    history.forEach((turn, idx) => {
      if (idx < currIdx || (idx === currIdx && turn.isCounterQuestion)) {
        if (turn.question) {
          conversationMessages.push({
            role: 'assistant',
            content: turn.isCounterQuestion 
              ? `[Counter-Question / Doubt Probe]: ${turn.question}` 
              : turn.question
          });
        }
        if (turn.answer) {
          conversationMessages.push({
            role: 'user',
            content: turn.answer
          });
        }
      }
    });
  }

  // Add current turn context
  const currentQ = (history && history[currIdx] && history[currIdx].question)
    || (history && history.length > 0 ? history[history.length - 1].question : `Question ${currIdx + 1}`);

  conversationMessages.push({
    role: 'assistant',
    content: currentQ
  });

  const currentTurnInstruction = `Candidate's Answer: "${candidateAnswer || '(No response provided)'}"

Session Status: Question ${currIdx + 1} of ${total} total questions.
Previous Turn was a Counter-Probe: ${isPreviousTurnCounter ? 'YES (Candidate has already answered a counter-question for this topic. Do NOT ask another counter-question; synthesize their clarification and advance)' : 'NO (Analyze for doubts/hesitation and counter if ambiguous)'}

Generate your response strictly matching the JSON schema.`;

  conversationMessages.push({
    role: 'user',
    content: currentTurnInstruction
  });

  try {
    const aiResponse = await callPrimaryLLM(conversationMessages, { groqApiKey: activeKey });
    let finalNextQuestion = aiResponse.question;

    let shouldCounter = !isPreviousTurnCounter && !!aiResponse.isCounterQuestion;
    // Don't counter on totally empty or skip answers
    const cleanAns = (candidateAnswer || '').toLowerCase().trim();
    if (!cleanAns || cleanAns === 'skip' || cleanAns === 'pass') {
      shouldCounter = false;
    }

    const finalNextIndex = shouldCounter ? currIdx : nextIndex;
    const isComplete = !shouldCounter && (aiResponse.isComplete || finalNextIndex >= total);

    // Validate that question is not a verbatim duplicate
    const askedQuestions = history.map(h => h.question);
    if (!isComplete && !shouldCounter && askedQuestions.some(asked => isSimilarQuestion(finalNextQuestion, asked))) {
      console.log(`[Server] Detected near-identical duplicate question. Generating contextual follow-up instead.`);
      const contextualObj = generateContextualFollowUp(candidateAnswer, topic, difficulty, history, finalNextIndex, total, false);
      finalNextQuestion = contextualObj.question;
    }

    res.json({
      feedback: aiResponse.feedback,
      question: finalNextQuestion,
      emotion: aiResponse.emotion || (shouldCounter ? 'thinking' : 'professional'),
      isComplete: isComplete,
      isCounterQuestion: shouldCounter,
      doubtReason: shouldCounter ? (aiResponse.doubtReason || "Ambiguity or partial explanation detected") : null,
      skillDomain: aiResponse.skillDomain || "Core Technical Concepts",
      modelUsed: aiResponse.modelUsed || 'gemini-2.5-flash',
      currentQuestionIndex: finalNextIndex
    });
  } catch (error) {
    console.warn("AI call failed on submit-answer, falling back to contextual follow-up engine:", error.message);
    const contextualObj = generateContextualFollowUp(candidateAnswer, topic, difficulty, history, nextIndex, total, isPreviousTurnCounter);
    const shouldCounter = !isPreviousTurnCounter && !!contextualObj.isCounterQuestion;
    const finalNextIndex = shouldCounter ? currIdx : nextIndex;
    const isComplete = !shouldCounter && finalNextIndex >= total;

    res.json({
      feedback: contextualObj.feedback || "Good response.",
      question: contextualObj.question,
      emotion: contextualObj.emotion || (shouldCounter ? 'thinking' : 'professional'),
      isComplete: isComplete,
      isCounterQuestion: shouldCounter,
      doubtReason: shouldCounter ? (contextualObj.doubtReason || "Clarification needed") : null,
      skillDomain: contextualObj.skillDomain || "Core Technical Concepts",
      currentQuestionIndex: finalNextIndex
    });
  }
});

// Endpoint 3: End Interview / Compile Report
app.post('/api/end-interview', async (req, res) => {
  const {
    name, topic, difficulty, history, codingQuestion, codingQuestionsList,
    codingScoreDetails, candidateCode, codingTestResults, tabWarningsCount,
    warningCounts, disqualified, disqualificationReason, groqApiKey,
    violationScreenshots, language, isEarlyExit, totalQuestions, currentQuestionIndex
  } = req.body;

  console.log(`Generating final report for ${name} on topic "${topic}" (Disqualified: ${disqualified || false}, lang: ${language || 'en-IN'}, isEarlyExit: ${isEarlyExit || false})`);

  const rawHistory = history || req.body.chatHistory || [];

  // Handle immediate proctoring disqualification
  if (disqualified) {
    const formattedReason = disqualificationReason ? disqualificationReason.charAt(0).toUpperCase() + disqualificationReason.slice(1) : "Proctoring Violation";
    const finalReport = {
      overallScore: 0,
      verbalScore: 0,
      codingScore: 0,
      strengths: ["Session initiated successfully."],
      improvements: [`DISQUALIFIED: The interview was terminated early due to 5 proctoring violations in the "${formattedReason}" category.`],
      breakdown: rawHistory.map((item, index) => ({
        question: item.question,
        answer: item.answer || "(No response)",
        idealAnswer: "N/A - Session Terminated due to disqualification.",
        feedback: `Question ${index + 1} was skipped or incomplete due to proctoring termination.`,
        score: 0
      })),
      codingFeedback: `Disqualified. Session was terminated early due to 5 repeated proctoring violations: ${formattedReason}. Under proctoring guidelines, connection of multiple monitors, disabling the camera, tab changes, keyboard cheating shortcuts, or leaving fullscreen mode is strictly forbidden and results in an automatic zero score.`,
      generalTips: [
        "Strictly adhere to proctoring policies.",
        "Ensure a single-screen setup and keep your webcam enabled at all times.",
        "Remain focused inside the active browser viewport throughout the session."
      ],
      isMock: true,
      isDisqualified: true,
      violationScreenshots: violationScreenshots || []
    };
    return res.json(finalReport);
  }

  const activeKey = groqApiKey || process.env.GROQ_API_KEY || SECONDARY_GROQ_API_KEY;
  const targetTotal = parseInt(totalQuestions) || (Array.isArray(rawHistory) && rawHistory.length > 0 ? rawHistory.length : 5);

  // Separate verbal theory history from coding questions
  const verbalHistory = rawHistory.filter(h => !h.isCoding && !h.isCodingChallenge && !h.isCode);

  // Helper to generate a structured fallback Skill Map
  const generateFallbackSkillMap = (historyItems, avgScore, topicName) => {
    const domainNames = [
      "Core Architecture & Foundations",
      "Asynchronous Concurrency & Runtime Mechanics",
      "Performance, Caching & Memory Optimization",
      "System Resilience, Error Handling & Edge Cases"
    ];

    return domainNames.map((domain, dIdx) => {
      const relatedQuestions = historyItems.filter((_, idx) => idx % domainNames.length === dIdx).map((item, qIdx) => `Q${qIdx + 1}: ${item.question ? item.question.substring(0, 45) + '...' : 'Technical Prompt'}`);
      const domainScore = avgScore <= 5 ? 0 : Math.min(100, Math.max(0, Math.round(avgScore + (dIdx === 0 ? 5 : (dIdx === 1 ? -4 : (dIdx === 2 ? 2 : -3))))));
      const level = domainScore >= 85 ? "Master" : (domainScore >= 70 ? "Proficient" : (domainScore >= 50 ? "Developing" : "Needs Review"));

      return {
        skill: domain,
        score: domainScore,
        level: level,
        questionsCovered: relatedQuestions.length > 0 ? relatedQuestions : [`Foundational ${topicName} Questions`],
        demonstratedCompetence: domainScore >= 70
          ? `Articulated key structural definitions and practical use-cases with technical clarity.`
          : (domainScore >= 35
            ? `Demonstrated preliminary familiarity, though depth was limited on specific runtime details.`
            : `No verified competence demonstrated in this domain during the assessment.`),
        identifiedGaps: domainScore >= 70
          ? `Can deepen operational knowledge around high-throughput edge-case isolation.`
          : `Recommend reviewing core internal mechanisms, lifecycle phases, and error-handling patterns.`
      };
    });
  };

  // Detect if candidate provided ANY substantive answers
  const isCandidateAnswerValid = (ansText) => {
    if (!ansText) return false;
    const a = ansText.trim().toLowerCase();
    if (!a || a === '(no response)' || a === '(assessment cancelled without response)' || a === 'skip' || a === 'pass' || a === 'next') return false;
    if (a.includes("don't know") || a.includes("dont know") || a.includes("no idea") || a.includes("can't answer") || a.includes("cant answer")) return false;
    if (a.includes("कुछ नहीं पता") || a.includes("नहीं पता") || a.includes("पता नहीं") || a.includes("malum nahi") || a.includes("nahi pata")) return false;
    return a.split(/\s+/).length >= 2;
  };

  const scoreCandidateAnswer = (ansText, idealAnswer, keywords = []) => {
    if (!isCandidateAnswerValid(ansText)) return 0;
    const lowerAns = (ansText || '').toLowerCase();
    let matchedCount = 0;
    keywords.forEach(kw => {
      if (lowerAns.includes(kw.toLowerCase())) matchedCount++;
    });
    const ratio = keywords.length > 0 ? matchedCount / keywords.length : 0.5;
    let score = 30; // base score for genuine attempt
    if (ratio > 0) score += Math.round(ratio * 60);
    const wordCount = lowerAns.split(/\s+/).length;
    score += Math.min(Math.round(wordCount / 4), 10);
    return Math.max(0, Math.min(100, score));
  };

  const substantiveAnswersCount = verbalHistory.filter(h => isCandidateAnswerValid(h.answer)).length;

  // STRICT ZERO-SCORE PROTECTION: If candidate answered 0 questions or all answers were empty/skip/don't know
  if (verbalHistory.length === 0 || substantiveAnswersCount === 0) {
    console.log(`[Scoring Engine] Candidate ${name} provided 0 substantive responses (attempted: ${verbalHistory.length}/${targetTotal}). Issuing strict 0% score and No Hire.`);
    const breakdown = verbalHistory.map((item, idx) => ({
      question: item.question,
      answer: item.answer || "(No response)",
      wasCountered: !!item.isCounterQuestion,
      counterDoubt: item.doubtReason || null,
      idealAnswer: "A model answer is not available for this question.",
      feedback: "Zero points awarded. No technical response was provided; the prompt was skipped, answered with uncertainty, or cancelled prematurely.",
      skill: item.skillDomain || "Technical Competency",
      score: 0
    }));

    const skillMap = generateFallbackSkillMap(verbalHistory, 0, topic);

    return res.json({
      overallScore: 0,
      verbalScore: 0,
      codingScore: null,
      executiveSummary: `${name} initiated the ${difficulty}-level mock technical assessment specializing in "${topic}". However, the candidate did not provide any substantive technical answers—prompts were either left unanswered, skipped, acknowledged with unfamiliarity, or the session was ended prematurely during question ${verbalHistory.length || 1} of ${targetTotal}.\n\nBecause no technical explanations, architectural definitions, or code solutions were submitted, no competency could be validated. Under formal evaluation guidelines, the candidate receives an assessment score of 0% and a No Hire determination for this role.`,
      knowledgeDepthAssessment: "Zero technical depth demonstrated. All presented questions were skipped, unanswered, or acknowledged with unfamiliarity.",
      communicationAndClarity: "Unable to evaluate technical communication due to the absence of substantive verbal responses.",
      hiringRecommendation: "No Hire - Assessment was terminated early or no valid technical responses were provided.",
      strengths: ["No verified technical competencies demonstrated during this assessment."],
      improvements: [
        `Attempt every scheduled technical question and explain your thought process.`,
        `Review foundational and architectural concepts for ${topic} before re-attempting.`,
        `Do not exit or cancel the interview session prematurely.`
      ],
      skillMap,
      breakdown,
      codingFeedback: "No coding challenge was attempted or completed.",
      codingScoreDetails: [],
      codingTestResults: null,
      generalTips: [
        "Always define the core term and its purpose before discussing practical advantages.",
        "Attempt every prompt and explain your reasoning even when uncertain.",
        "Complete the full assessment session to allow fair skill evaluation."
      ],
      isAborted: true,
      isEarlyExit: isEarlyExit || (verbalHistory.length < targetTotal),
      isMock: true
    });
  }

  if (!activeKey) {
    // FALLBACK MODE - Smart local evaluation
    const questionsList = getMockQuestionsForTopic(topic);
    const breakdown = verbalHistory.map((item, idx) => {
      const ans = (item.answer || '').trim();
      const lowerAns = ans.toLowerCase();

      // Find original mock question object to retrieve ideal answer and keywords
      const matchedQ = questionsList.find(q => {
        const questionTextClean = q.question.toLowerCase().trim();
        const itemQuestionClean = item.question.replace(/Hello.*first question\.\s*/, '').toLowerCase().trim();
        return itemQuestionClean.includes(questionTextClean) || questionTextClean.includes(itemQuestionClean);
      }) || { question: item.question, idealAnswer: "A model answer is not available for this question.", keywords: [] };

      const keywords = matchedQ.keywords || [];

      // Detect empty or evasive responses
      const isNegative = lowerAns === '' || 
                         lowerAns.includes("don't know") || 
                         lowerAns.includes("dont know") || 
                         lowerAns.includes("no idea") || 
                         lowerAns.includes("skip") || 
                         lowerAns.includes("pass") || 
                         lowerAns.includes("can't answer") || 
                         lowerAns.split(/\s+/).length < 3;

      if (isNegative) {
        return {
          question: item.question,
          answer: ans || "(No response)",
          wasCountered: !!item.isCounterQuestion,
          counterDoubt: item.doubtReason || null,
          idealAnswer: matchedQ.idealAnswer,
          feedback: "You skipped this question or stated you didn't know the answer. In technical interviews, explaining your thought process is critical even when uncertain.",
          skill: "Foundational Knowledge",
          score: 0
        };
      }

      let matchedCount = 0;
      keywords.forEach(kw => {
        if (lowerAns.includes(kw)) matchedCount++;
      });

      const ratio = keywords.length > 0 ? matchedCount / keywords.length : 0.5;
      let score = 30; // base score for genuine attempt
      if (ratio > 0) score += Math.round(ratio * 60);
      const wordCount = lowerAns.split(/\s+/).length;
      score += Math.min(Math.round(wordCount / 4), 10);
      score = Math.min(score, 100);

      let feedback = "";
      if (score < 45) {
        feedback = `Your answer was brief and omitted key concepts such as: ${keywords.slice(0, 3).join(', ')}. Expand on technical definitions.`;
      } else if (score < 75) {
        feedback = `Good attempt. You touched on the core principles, but try to elaborate on ${keywords.slice(2, 5).join(', ')} and cite practical production scenarios.`;
      } else {
        feedback = `Excellent! You demonstrated solid mastery by clearly explaining ${keywords.join(', ')}.`;
      }

      return {
        question: item.question,
        answer: ans,
        wasCountered: !!item.isCounterQuestion,
        counterDoubt: item.doubtReason || null,
        idealAnswer: matchedQ.idealAnswer,
        feedback,
        skill: item.skillDomain || "Technical Competency",
        score
      };
    });

    const averageTheoryScore = breakdown.length > 0 
      ? Math.round(breakdown.reduce((sum, item) => sum + item.score, 0) / Math.max(targetTotal, breakdown.length)) 
      : 0;

    // Evaluate code programmatically if coding challenge was completed
    const passedCount = codingTestResults ? parseInt(codingTestResults.passedCount) || 0 : 0;
    const totalCount = codingTestResults ? parseInt(codingTestResults.totalCount) || 3 : 3;
    const codingScore = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
    
    // Overall composite score
    const hasCoding = codingScoreDetails && codingScoreDetails.length > 0;
    const overallScore = hasCoding 
      ? Math.round((averageTheoryScore * 0.6) + (codingScore * 0.4)) 
      : averageTheoryScore;

    let codingFeedback = '';
    if (hasCoding) {
      codingFeedback = codingScoreDetails.map((detail, idx) => {
        return `**Challenge ${idx + 1}: ${detail.title}**\n` + 
          `- Passed: ${detail.passedCount} / ${detail.totalCount} test cases.\n` +
          `- Review: ${detail.passedCount === detail.totalCount ? 'Excellent work, all test cases verified successfully.' : 'Check edge-case boundaries and logic constraints to resolve failing test cases.'}`;
      }).join('\n\n');
    } else if (codingQuestion) {
      codingFeedback = passedCount === totalCount
        ? `Your solution for "${codingQuestion?.title || 'Coding Challenge'}" successfully passed all ${passedCount}/${totalCount} local test cases! The implementation is clean, logically sound, and correctly solves the problem.`
        : `Your solution for "${codingQuestion?.title || 'Coding Challenge'}" passed ${passedCount} out of ${totalCount} test cases. Review the failing inputs or boundary constraints.`;
    }

    const isFailing = averageTheoryScore < 50 || substantiveAnswersCount === 0;

    const executiveSummary = isFailing
      ? `${name} completed an assessment for ${difficulty}-level in "${topic}", but achieved an average score of ${averageTheoryScore}%. The candidate showed limited or incomplete mastery of core engineering principles across the evaluated questions. Targeted study of essential concepts and architectural mechanics is required.`
      : `${name} participated in a ${difficulty}-level mock technical interview specializing in ${topic}. Throughout the verbal theory questions, the candidate demonstrated ${averageTheoryScore >= 75 ? 'a solid technical foundation and clear conceptual command' : 'introductory familiarity, though several topics would benefit from deeper architectural precision'}. Their explanations revealed a capable understanding of core definitions, while follow-up probing provided an opportunity to observe their resilience and reasoning under scrutiny.`;

    const knowledgeDepthAssessment = isFailing
      ? `The candidate demonstrated minimal depth across the assessed technical areas. Fundamental definitions were either omitted or incomplete, and follow-up probes revealed critical knowledge gaps.`
      : `The candidate demonstrated ${averageTheoryScore >= 75 ? 'commendable' : 'moderate'} depth across the assessed technical domains. Primary definitional inquiries were handled with reasonable accuracy.`;

    const communicationAndClarity = isFailing
      ? `Technical communication was brief or incomplete. Developing structured answers that cite concrete technical terms and system mechanics will improve interview performance.`
      : `Verbal communication was ${averageTheoryScore >= 75 ? 'clear, professional, and well-paced' : 'comprehensible but occasionally brief'}.`;

    const hiringRecommendation = averageTheoryScore >= 80 
      ? "Strong Hire - Candidate demonstrated robust conceptual mastery and solid technical articulation."
      : (averageTheoryScore >= 68 
        ? "Hire - Competent engineer with dependable foundational knowledge and minor growth opportunities."
        : (averageTheoryScore >= 50 
          ? "Leaning Hire - Demonstrates potential; recommend targeted preparation in complex architectural edge cases."
          : "No Hire - Technical responses fell below the required competency threshold."));

    const strengths = isFailing
      ? ["No verified technical competencies demonstrated in the submitted responses."]
      : (overallScore >= 70 
        ? ["Demonstrated solid comprehension of primary technical concepts.", "Used standard technical terminology effectively.", "Engaged constructively with interview probing."]
        : ["Attempted all core technical questions with sincerity.", "Clear, audible communication cadence.", "Demonstrated willingness to tackle complex prompts."]);

    const improvements = overallScore >= 70
      ? ["Deepen architectural explanations for high-concurrency systems.", "Illustrate trade-offs between memory footprint and latency.", "Optimize code time and space complexity in algorithmic solutions."]
      : ["Study core definitions and runtime lifecycles.", "Elaborate thoroughly rather than providing brief answers.", "Practice explaining edge-cases and error-recovery mechanisms."];

    if (tabWarningsCount > 0) {
      improvements.push(`Avoid switching browser tabs during the assessment (detected ${tabWarningsCount} tab changes).`);
    }

    const skillMap = generateFallbackSkillMap(verbalHistory, averageTheoryScore, topic);

    return res.json({
      overallScore,
      verbalScore: averageTheoryScore,
      codingScore: hasCoding ? codingScore : null,
      executiveSummary,
      knowledgeDepthAssessment,
      communicationAndClarity,
      hiringRecommendation,
      strengths,
      improvements,
      skillMap,
      breakdown,
      codingFeedback,
      codingScoreDetails: codingScoreDetails || [],
      codingTestResults: codingTestResults || null,
      generalTips: [
        "Always define the core term and its purpose before discussing practical advantages.",
        "Highlight engineering trade-offs when discussing architectural decisions.",
        "Proactively discuss failure modes, edge cases, and asynchronous race conditions.",
        "Analyze time and space complexity before finalizing technical solutions."
      ],
      isMock: true
    });
  }

  // LLM MODE - Send verbal questions and responses (excluding coding questions) to LLM API
  const formattedVerbalHistory = verbalHistory.map((h, i) => {
    let turnText = `### Question ${i + 1}: "${h.question}"\nCandidate Answer: "${h.answer || '(No response provided)'}"`;
    if (h.isCounterQuestion) {
      turnText += `\n[NOTE: This was an AI Counter-Question probing ambiguity/doubt: "${h.doubtReason || 'Technical depth probe'}"]`;
    }
    if (h.skillDomain) {
      turnText += `\n[Skill Domain: ${h.skillDomain}]`;
    }
    return turnText;
  }).join('\n\n');

  const langMeta = getLanguageInstruction(language);
  const systemPrompt = `You are a Principal Engineering Director and Senior Technical Evaluation Committee Chair conducting an executive-level performance assessment.
Interview Language: ${language || 'English'}
${langMeta.instruction}
You must return your response in a clean, valid JSON object containing:
- "overallScore": Integer (0-100) reflecting candidate's verbal technical mastery and conceptual depth.
- "executiveSummary": A Formal Natural Evaluation report (2-3 detailed, formal paragraphs) assessing candidate's technical profile, conceptual maturity, reasoning structure, and suitability for ${difficulty} level in "${topic}".
- "knowledgeDepthAssessment": A detailed analytical paragraph evaluating the candidate's conceptual depth, mastery of edge cases, and how effectively they responded to counter-probing or clarified doubts.
- "communicationAndClarity": An analytical paragraph evaluating verbal precision, technical vocabulary, structure, and conciseness.
- "hiringRecommendation": A clear verdict ("Strong Hire", "Hire", "Leaning Hire", "Needs Further Preparation", "No Hire") with a detailed professional rationale.
- "strengths": Array of 1-4 specific, evidence-backed strengths observed in the verbal responses. NOTE: If candidate gave no substantive answers or scored below 40, you MUST return: ["No verified technical competencies demonstrated in the submitted responses."].
- "improvements": Array of 3-5 concrete growth areas with actionable recommendations.
- "skillMap": Array of 3-5 competency domains evaluated across the questions and answers:
  Each item in "skillMap":
  {
    "skill": "Competency Domain Name (e.g. Asynchronous Concurrency, State Architecture, Memory Optimization)",
    "score": [Integer 0 to 100],
    "level": "Master" | "Proficient" | "Developing" | "Needs Review",
    "questionsCovered": ["List of question numbers or brief topics covered"],
    "demonstratedCompetence": "Specific concepts the candidate proved they know",
    "identifiedGaps": "Specific doubts, omissions, or gaps observed"
  }
- "breakdown": Array of evaluated items for all verbal questions asked:
  Each item in "breakdown":
  {
    "question": "Exact question asked",
    "answer": "Candidate's response",
    "wasCountered": boolean,
    "counterDoubt": "Explanation of doubt probed or null",
    "idealAnswer": "Formal model answer (2-3 sentences)",
    "feedback": "Detailed constructive critique",
    "skill": "Associated skill domain",
    "score": [Integer 0 to 100]
  }
- "generalTips": Array of 3-4 professional career and technical interview tips.

SCORING RULES (CRITICAL INTEGRITY):
1. Grade the answers strictly against the correct technical definitions of the concepts asked.
2. If candidate's answer is extremely short, irrelevant, gibberish, or says "I don't know", "skip", "pass", "मुझे कुछ नहीं पता", or left empty, award a score of EXACTLY 0.
3. Scoring Rubric for each question:
   - 90-100: Complete, accurate, detailed answer with deep technical terminology and code/architectural understanding.
   - 70-89: Generally correct, covers main definitions, but lacks detail or minor aspects are omitted.
   - 40-69: Partially correct or very brief, misses major definitions or concepts.
   - 1-39: Extremely brief or contains major technical inaccuracies.
   - 0: Empty, skipped, or equivalent to "I don't know" / non-responsive.
4. Total Expected Questions: The candidate was planned for ${targetTotal} total questions.
   - Total verbalScore MUST be (Sum of breakdown scores) / ${targetTotal}.
   - If candidate completed fewer questions or exited early, unattempted questions count as 0.
5. NEVER fabricate fake compliments (e.g., "candidate stayed calm", "polite response", "spoke in their chosen language") if technical knowledge was absent. If overall score is under 40 or answers were non-substantive, strengths MUST state "No verified technical competencies demonstrated in the submitted responses." and hiringRecommendation MUST be "No Hire".
6. If 'Tab switching warning violations count' is greater than 0, add a warning under 'improvements' stating: "Ensure compliance with interview guidelines (detected X tab changes)." where X is the count.`;

  const prompt = `Candidate: ${name}
Role / Seniority: ${difficulty} level mock interview for "${topic}".
Interview Language: ${language || 'English'}
Planned Total Questions: ${targetTotal}
Questions Recorded: ${verbalHistory.length}
Substantive Technical Answers: ${substantiveAnswersCount}
Early Exit / Incomplete: ${isEarlyExit ? 'YES' : 'NO'}
Tab switching warning violations count: ${tabWarningsCount || 0}

VERBAL TECHNICAL INTERVIEW TRANSCRIPT (ALL VERBAL QUESTIONS & CANDIDATE RESPONSES):
${formattedVerbalHistory || '(No verbal responses recorded)'}

INSTRUCTIONS:
1. Conduct an in-depth, fair knowledge analysis of the candidate's verbal responses. Note where the candidate had doubts or where the AI countered and gave them a chance to clarify.
2. Formulate the Formal Natural Evaluation Report with executiveSummary, knowledgeDepthAssessment, communicationAndClarity, hiringRecommendation, strengths, improvements, generalTips.
3. Construct the comprehensive Skill Map mapping the questions asked and candidate's responses into distinct competency domains with individual scores (0-100) and levels ("Master", "Proficient", "Developing", "Needs Review").
4. Score each question objectively under "breakdown" using the strict 0-100 rubric.
5. Return strictly valid JSON matching the systemPrompt schema.`;

  try {
    const aiResponse = await callPrimaryLLM(prompt, { systemPrompt, groqApiKey: activeKey });

    // Handle separate coding evaluation if code was submitted
    const hasCoding = codingScoreDetails && codingScoreDetails.length > 0;
    const passedCount = codingTestResults ? parseInt(codingTestResults.passedCount) || 0 : 0;
    const totalCount = codingTestResults ? parseInt(codingTestResults.totalCount) || 3 : 3;
    const codingScore = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;

    let codingFeedbackStr = '';
    if (hasCoding) {
      codingFeedbackStr = codingScoreDetails.map((detail, idx) => {
        return `**Challenge ${idx + 1}: ${detail.title}**\n` + 
          `- Passed: ${detail.passedCount} / ${detail.totalCount} test cases.\n` +
          `- Review: ${detail.passedCount === detail.totalCount ? 'Excellent work, all test cases passed.' : 'Check boundary conditions and logic constraints to resolve failed test cases.'}`;
      }).join('\n\n');
    } else if (codingQuestion) {
      codingFeedbackStr = passedCount === totalCount
        ? `Your solution for "${codingQuestion?.title || 'Coding Challenge'}" successfully passed all ${passedCount}/${totalCount} local test cases! The implementation is clean, logically sound, and correctly solves the problem.`
        : `Your solution for "${codingQuestion?.title || 'Coding Challenge'}" passed ${passedCount} out of ${totalCount} test cases. Review the failing inputs or boundary constraints.`;
    }

    // Mathematically verify verbalScore from breakdown items
    const parsedBreakdown = Array.isArray(aiResponse.breakdown) ? aiResponse.breakdown : [];
    let breakdownSum = 0;
    parsedBreakdown.forEach(item => {
      const qScore = parseInt(item.score);
      item.score = !isNaN(qScore) ? Math.max(0, Math.min(100, qScore)) : 0;
      breakdownSum += item.score;
    });

    const divisor = Math.max(targetTotal, parsedBreakdown.length, 1);
    const calculatedVerbalScore = Math.round(breakdownSum / divisor);

    let rawScore = parseInt(aiResponse.overallScore);
    if (isNaN(rawScore)) {
      rawScore = calculatedVerbalScore;
    } else {
      rawScore = Math.max(0, Math.min(100, rawScore));
    }

    // Enforce truth in scoring: cannot exceed mathematically averaged breakdown
    const verbalScore = (substantiveAnswersCount === 0) 
      ? 0 
      : Math.min(rawScore, calculatedVerbalScore);

    const compositeScore = hasCoding 
      ? Math.round((verbalScore * 0.6) + (codingScore * 0.4)) 
      : verbalScore;

    const isFailing = compositeScore < 50 || substantiveAnswersCount === 0 || (isEarlyExit && compositeScore < 60);

    let finalRecommendation = aiResponse.hiringRecommendation || (compositeScore >= 70 ? 'Hire' : 'No Hire');
    if (isFailing && !finalRecommendation.toLowerCase().includes('no hire')) {
      finalRecommendation = 'No Hire';
    }

    let finalStrengths = Array.isArray(aiResponse.strengths) ? aiResponse.strengths : [];
    if (compositeScore < 40 || substantiveAnswersCount === 0 || finalStrengths.length === 0) {
      finalStrengths = ["No verified technical competencies demonstrated in the submitted responses."];
    }

    let finalSkillMap = Array.isArray(aiResponse.skillMap) ? aiResponse.skillMap : [];
    if (substantiveAnswersCount === 0 || verbalScore === 0) {
      finalSkillMap = generateFallbackSkillMap(verbalHistory, 0, topic);
    }

    res.json({
      overallScore: compositeScore,
      verbalScore: verbalScore,
      codingScore: hasCoding ? codingScore : null,
      executiveSummary: aiResponse.executiveSummary || '',
      knowledgeDepthAssessment: aiResponse.knowledgeDepthAssessment || '',
      communicationAndClarity: aiResponse.communicationAndClarity || '',
      hiringRecommendation: finalRecommendation,
      strengths: finalStrengths,
      improvements: aiResponse.improvements || [],
      skillMap: finalSkillMap,
      breakdown: parsedBreakdown,
      codingFeedback: codingFeedbackStr,
      codingScoreDetails: codingScoreDetails || [],
      codingTestResults: codingTestResults || null,
      generalTips: aiResponse.generalTips || [
        "Always define the core term and its purpose before discussing practical advantages.",
        "Highlight engineering trade-offs when discussing architectural decisions.",
        "Proactively discuss failure modes, edge cases, and asynchronous race conditions."
      ],
      violationScreenshots: violationScreenshots || [],
      modelUsed: aiResponse.modelUsed || 'gemini-2.5-flash',
      isMock: false
    });
  } catch (error) {
    console.error("AI report generation failed, using mock report:", error.message);
    const questionsList = getMockQuestionsForTopic(topic);
    const breakdown = verbalHistory.map((item) => {
      const matchedQ = questionsList.find(q => {
        const questionTextClean = q.question.toLowerCase().trim();
        const itemQuestionClean = item.question.replace(/Hello.*first question\.\s*/, '').toLowerCase().trim();
        return itemQuestionClean.includes(questionTextClean) || questionTextClean.includes(itemQuestionClean);
      }) || { question: item.question, idealAnswer: "A model answer is not available for this question.", keywords: [] };

      const isSubstantive = isCandidateAnswerValid(item.answer);
      const score = isSubstantive
        ? scoreCandidateAnswer(item.answer, matchedQ.idealAnswer, matchedQ.keywords || [])
        : 0;

      return {
        question: item.question,
        answer: item.answer || "(No response)",
        wasCountered: !!item.isCounterQuestion,
        counterDoubt: item.doubtReason || null,
        idealAnswer: matchedQ.idealAnswer,
        feedback: isSubstantive 
          ? "Answer evaluated against foundational standards." 
          : "No substantive technical answer provided.",
        skill: item.skillDomain || "Technical Competency",
        score
      };
    });

    const sumTheory = breakdown.reduce((sum, item) => sum + item.score, 0);
    const divisor = Math.max(targetTotal, breakdown.length, 1);
    const averageTheoryScore = substantiveAnswersCount === 0 
      ? 0 
      : Math.round(sumTheory / divisor);

    const passedCount = codingTestResults ? parseInt(codingTestResults.passedCount) || 0 : 0;
    const totalCount = codingTestResults ? parseInt(codingTestResults.totalCount) || 3 : 3;
    const codingScore = totalCount > 0 ? Math.round((passedCount / totalCount) * 100) : 0;
    const hasCoding = codingScoreDetails && codingScoreDetails.length > 0;
    const overallScore = hasCoding ? Math.round((averageTheoryScore * 0.6) + (codingScore * 0.4)) : averageTheoryScore;

    let codingFeedbackStr = '';
    if (hasCoding) {
      codingFeedbackStr = codingScoreDetails.map((detail, idx) => {
        return `Challenge ${idx + 1}: Passed ${detail.passedCount}/${detail.totalCount} cases.`;
      }).join(', ');
    } else {
      codingFeedbackStr = `Passed ${passedCount}/${totalCount} test cases.`;
    }

    const isFailing = overallScore < 50 || substantiveAnswersCount === 0 || (isEarlyExit && overallScore < 60);

    const executiveSummary = isFailing
      ? `${name} attempted the ${difficulty}-level mock technical interview for ${topic}. The interview was concluded with insufficient technical responses to demonstrate required competency. Foundational concepts in "${topic}" need substantial study before reapplying.`
      : `${name} completed the ${difficulty}-level mock technical interview for ${topic}. The candidate exhibited steady familiarity with foundational topics and answered technical questions with clarity and focus. While primary concepts were articulated adequately, further exploration into complex system architecture and edge-case guarantees will strengthen their overall engineering profile.`;

    const skillMap = generateFallbackSkillMap(verbalHistory, averageTheoryScore, topic);

    res.json({
      overallScore: overallScore,
      verbalScore: averageTheoryScore,
      codingScore: hasCoding ? codingScore : null,
      executiveSummary,
      knowledgeDepthAssessment: isFailing
        ? "Unable to verify depth of technical knowledge due to lack of substantive responses."
        : "Demonstrated solid grasp of primary definitions with opportunities to expand on high-scale edge cases.",
      communicationAndClarity: isFailing
        ? "Limited communication recorded during the technical evaluation session."
        : "Clear and professional technical articulation.",
      hiringRecommendation: isFailing
        ? "No Hire - Performance did not meet minimum competency requirements."
        : (overallScore >= 70 ? "Hire - Capable candidate with solid technical foundations." : "Needs Further Preparation"),
      strengths: isFailing
        ? ["No verified technical competencies demonstrated in the submitted responses."]
        : ["Clear response delivery.", "Solid structural understanding of the topic.", "Completed the interview session with focus."],
      improvements: isFailing
        ? ["Review foundational documentation and complete practice questions before retaking.", "Provide detailed explanations including definitions, architecture, and examples."]
        : ["Provide more production-level examples.", "Address edge-cases in technical explanations.", "Analyze time complexity of code."],
      skillMap,
      breakdown,
      codingFeedback: `${codingFeedbackStr} Attempted solution for "${codingQuestion?.title || 'Challenge'}".`,
      codingScoreDetails: codingScoreDetails || [],
      codingTestResults: codingTestResults || null,
      generalTips: ["Structure your answers clearly.", "Practice speaking out loud to build confidence."],
      violationScreenshots: violationScreenshots || [],
      isMock: true
    });
  }
});

// Split text into small chunks to accommodate Google Translate TTS length limits
function splitTextIntoChunks(text, maxLength = 180) {
  const chunks = [];
  let currentChunk = '';

  // Split by sentences first
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      // If a single sentence is longer than maxLength, split it by spaces
      if (sentence.length > maxLength) {
        const words = sentence.split(' ');
        let tempChunk = '';
        for (const word of words) {
          if ((tempChunk + ' ' + word).length <= maxLength) {
            tempChunk += (tempChunk ? ' ' : '') + word;
          } else {
            if (tempChunk) chunks.push(tempChunk.trim());
            tempChunk = word;
          }
        }
        currentChunk = tempChunk;
      } else {
        currentChunk = sentence;
      }
    }
  }
  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

// Endpoint 3: Google Cloud Text-to-Speech (TTS) with ADC Auth
async function ttsHandler(req, res) {
  try {
    const text = req.query.text || req.body?.text;
    const lang = req.query.lang || req.body?.lang || 'en-IN';
    const voice = req.query.voice || req.body?.voice;
    const gender = req.query.gender || req.body?.gender;
    const speakingRate = parseFloat(req.query.rate || req.body?.rate || '1.0');
    if (!text) {
      return res.status(400).json({ error: "Text parameter is required" });
    }

    try {
      // Primary: Google Cloud Text-to-Speech via ADC Auth (Neural2 / Wavenet / REST)
      const audioBuffer = await synthesizeSpeechGoogleCloud(text, { lang, voice, gender, speakingRate });
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(audioBuffer);
    } catch (gcpTtsErr) {
      console.warn(`[TTS] Google Cloud TTS note: ${gcpTtsErr.message}. Serving speech via multilingual fallback...`);
      
      const chunks = splitTextIntoChunks(text);
      const audioBuffers = [];
      const isHindi = /[\u0900-\u097F]/.test(text) || lang.toLowerCase().startsWith('hi');
      let targetTl = isHindi ? 'hi' : 'en-in';
      if (!isHindi && lang && typeof lang === 'string' && lang.length >= 2) {
        const prefix = lang.split('-')[0].toLowerCase();
        if (['es', 'fr', 'de', 'ja', 'it', 'pt', 'ru', 'zh', 'ar', 'ta', 'te', 'mr', 'bn', 'ko', 'nl'].includes(prefix)) {
          targetTl = prefix;
        }
      }

      for (const chunk of chunks) {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${targetTl}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
        const response = await fetch(ttsUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      if (audioBuffers.length > 0) {
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(Buffer.concat(audioBuffers));
      }

      throw gcpTtsErr;
    }
  } catch (error) {
    console.error("[TTS Proxy] Speech synthesis error:", error);
    res.status(500).json({ error: "TTS service unavailable: " + error.message });
  }
}

app.get('/api/tts', ttsHandler);
app.post('/api/tts', ttsHandler);

// Endpoint 3.1: Test Google Cloud TTS directly
app.get('/api/tts/test', async (req, res) => {
  try {
    const text = req.query.text || "Hello! Google Cloud Text-to-Speech is connected and functioning properly.";
    const lang = req.query.lang || 'en-IN';
    const voice = req.query.voice;
    const audioBuffer = await synthesizeSpeechGoogleCloud(text, { lang, voice });
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint 3.5: Google Cloud Speech-to-Text (STT) with ADC Auth
app.post('/api/stt', async (req, res) => {
  try {
    const { audio, lang, language, encoding, sampleRateHertz } = req.body || {};
    if (!audio) {
      return res.status(400).json({ success: false, error: "Audio data is required (base64 or WebM audio chunk)" });
    }

    const selectedLang = lang || language || 'en-IN';
    const result = await transcribeAudioGoogleCloud(audio, {
      lang: selectedLang,
      encoding: encoding || 'WEBM_OPUS',
      sampleRateHertz: sampleRateHertz || 48000
    });

    res.json({
      success: true,
      transcript: result.transcript,
      confidence: result.confidence,
      detectedLanguage: result.detectedLanguage,
      isHinglish: result.isHinglish
    });
  } catch (error) {
    console.error("[Google Cloud STT] Transcription error:", error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Endpoint: Check Google Cloud Services & ADC Status
app.get('/api/google-cloud-status', async (req, res) => {
  try {
    const status = await getGoogleCloudStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint: Save Google Cloud ADC / Project Credentials dynamically
app.post('/api/save-credentials', async (req, res) => {
  try {
    const { credentialsJson, projectId, location, geminiApiKey, apiKey } = req.body || {};
    if (credentialsJson) {
      const parsed = typeof credentialsJson === 'string' ? JSON.parse(credentialsJson) : credentialsJson;
      const credsPath = path.join(__dirname, 'google_credentials.json');
      fs.writeFileSync(credsPath, JSON.stringify(parsed, null, 2), 'utf-8');
      process.env.GOOGLE_APPLICATION_CREDENTIALS = credsPath;
      console.log(`[Google Cloud] Saved ADC credentials to ${credsPath}`);
    }
    if (projectId) {
      process.env.GCP_PROJECT_ID = projectId;
    }
    if (location) {
      process.env.GCP_LOCATION = location;
    }
    if (geminiApiKey) {
      process.env.GEMINI_API_KEY = geminiApiKey;
    }
    if (apiKey) {
      process.env.GOOGLE_CLOUD_API_KEY = apiKey;
    }
    refreshGoogleClients();
    const status = await getGoogleCloudStatus();
    res.json({ success: true, message: 'Google Cloud configuration saved', status });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Endpoint 4: Real-time Mobile Phone Detection using Groq Vision
app.post('/api/detect-mobile', async (req, res) => {
  try {
    const { image, groqApiKey } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, error: "Image data is required" });
    }

    const primaryKey = groqApiKey || process.env.GROQ_API_KEY;
    const secondaryKey = process.env.SECONDARY_GROQ_API_KEY;

    const keysToTry = [];
    if (primaryKey) {
      keysToTry.push({ key: primaryKey, label: groqApiKey ? "custom frontend" : "primary" });
    }
    if (secondaryKey && secondaryKey !== primaryKey) {
      keysToTry.push({ key: secondaryKey, label: "secondary fallback" });
    }

    if (keysToTry.length === 0) {
      return res.status(500).json({ success: false, error: "GROQ_API_KEY is not configured on the server or frontend" });
    }

    const systemPrompt = `You are a strict proctoring system for an online interview.
Your ONLY job is to detect if a mobile phone or smartphone is 
visible anywhere in the image.

Respond ONLY with valid JSON in this exact format:
{
  "mobile_detected": true or false,
  "confidence": "high" or "medium" or "low",
  "location": "brief description of where in frame, or null",
  "box_2d": [ymin, xmin, ymax, xmax] or null
}

Rules & Guidelines:
- Pay extreme attention to the laptop display, laptop screen, and screen bezels. 
- Detect if a mobile phone is placed on, resting on, leaning against, or mounted on/near the laptop display, screen bezel, keyboard area, or desk nearby.
- Look for smartphones resting vertically or horizontally on the top, bottom, or sides of the laptop screen, which may show a camera bump, phone screen, side profile, or phone bezel.
- Set "mobile_detected" to true if ANY part of a phone is visible (screen, body, camera module, edge, or hand holding phone).
- Set "mobile_detected" to true if someone appears to be looking down at a device in their lap or off-screen.
- If "mobile_detected" is true, estimate the normalized bounding box coordinates [ymin, xmin, ymax, xmax] of the phone in the 0-1000 range. E.g. [350, 420, 750, 850]. Set "box_2d" to null if not detected or uncertain.
- Set "mobile_detected" to false ONLY if there is absolutely no phone evidence or device visible.
- Do NOT explain. JSON only.`;

    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${image}`
            }
          },
          {
            type: "text",
            text: "Scan this camera frame for mobile phone usage."
          }
        ]
      }
    ];

    const visionModels = [
      "llama-3.2-11b-vision-preview",
      "llama-3.2-90b-vision-preview",
      "meta-llama/llama-4-scout-17b-16e-instruct"
    ];

    let lastError = null;
    for (const keyObj of keysToTry) {
      const activeKey = keyObj.key;
      console.log(`[Groq Vision API] Attempting call with ${keyObj.label} API Key`);

      for (const model of visionModels) {
        try {
          console.log(`[Groq Vision API] Testing model "${model}"`);
          const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeKey}`
            },
            body: JSON.stringify({
              model,
              messages,
              response_format: {
                type: "json_object"
              },
              temperature: 0.2
            })
          });

          if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Groq API model "${model}" responded with status ${response.status}: ${errText}`);
          }

          const data = await response.json();
          const responseText = data.choices?.[0]?.message?.content;
          if (!responseText) {
            throw new Error(`Received empty message content from Groq Vision API model "${model}"`);
          }

          const parsedJSON = JSON.parse(responseText.trim());
          console.log(`[Groq Vision API] Success using model "${model}" and ${keyObj.label} key`);

          let savedScreenshotPath = null;
          if (parsedJSON.mobile_detected) {
            try {
              const base64Data = image.replace(/^data:image\/[a-z]+;base64,/, "");
              const imageBuffer = Buffer.from(base64Data, 'base64');
              const jimpImage = await Jimp.read(imageBuffer);
              
              const imgWidth = jimpImage.bitmap.width;
              const imgHeight = jimpImage.bitmap.height;

              // Draw box if coordinates are provided
              if (parsedJSON.box_2d && Array.isArray(parsedJSON.box_2d) && parsedJSON.box_2d.length === 4) {
                const ymin = Math.round((parsedJSON.box_2d[0] / 1000) * imgHeight);
                const xmin = Math.round((parsedJSON.box_2d[1] / 1000) * imgWidth);
                const ymax = Math.round((parsedJSON.box_2d[2] / 1000) * imgHeight);
                const xmax = Math.round((parsedJSON.box_2d[3] / 1000) * imgWidth);

                const x = Math.max(0, xmin);
                const y = Math.max(0, ymin);
                const w = Math.min(imgWidth - x, xmax - xmin);
                const h = Math.min(imgHeight - y, ymax - ymin);

                if (w > 0 && h > 0) {
                  const colorHex = 0xff0000ff; // Red border
                  const thickness = 4;
                  for (let t = 0; t < thickness; t++) {
                    for (let cx = x; cx < x + w; cx++) {
                      if (cx >= 0 && cx < imgWidth) {
                        if (y + t >= 0 && y + t < imgHeight) jimpImage.setPixelColor(colorHex, cx, y + t);
                        if (y + h - 1 - t >= 0 && y + h - 1 - t < imgHeight) jimpImage.setPixelColor(colorHex, cx, y + h - 1 - t);
                      }
                    }
                    for (let cy = y; cy < y + h; cy++) {
                      if (cy >= 0 && cy < imgHeight) {
                        if (x + t >= 0 && x + t < imgWidth) jimpImage.setPixelColor(colorHex, x + t, cy);
                        if (x + w - 1 - t >= 0 && x + w - 1 - t < imgWidth) jimpImage.setPixelColor(colorHex, x + w - 1 - t, cy);
                      }
                    }
                  }
                }
              }

              const violationsDir = path.join(__dirname, 'public', 'violations');
              if (!fs.existsSync(violationsDir)) {
                fs.mkdirSync(violationsDir, { recursive: true });
              }

              const filename = `violation_${Date.now()}.jpg`;
              const filePath = path.join(violationsDir, filename);
              await jimpImage.write(filePath);
              savedScreenshotPath = `/violations/${filename}`;
              console.log(`[Groq Vision API] Saved violation screenshot to ${filePath}`);
            } catch (saveErr) {
              console.error("[Groq Vision API] Failed to save screenshot or draw box:", saveErr);
            }
          }

          return res.json({
            success: true,
            mobile_detected: !!parsedJSON.mobile_detected,
            confidence: parsedJSON.confidence || "low",
            location: parsedJSON.location || null,
            screenshot: savedScreenshotPath
          });
        } catch (error) {
          console.warn(`[Groq Vision API] Warning: ${keyObj.label} API Key with model "${model}" failed. Error: ${error.message}`);
          lastError = error;

          if (error.message.includes("status 401") || error.message.includes("status 403")) {
            console.warn(`[Groq Vision API] Auth/Access error. Skipping remaining models for this key.`);
            break;
          }
        }
      }
    }

    throw lastError || new Error("All Groq Vision attempts failed.");
  } catch (error) {
    console.error("Error in /api/detect-mobile route:", error);
    return res.json({ success: false, error: error.message });
  }
});

// WebRTC Signaling storage for secondary mobile camera connection
const webrtcSessions = new Map();

app.post('/api/webrtc/offer', (req, res) => {
  const { sessionId, offer } = req.body;
  if (!sessionId || !offer) {
    return res.status(400).json({ success: false, error: "sessionId and offer are required" });
  }
  webrtcSessions.set(sessionId, { offer, answer: null, timestamp: Date.now() });
  return res.json({ success: true });
});

app.get('/api/webrtc/offer', (req, res) => {
  const { sessionId } = req.query;
  const session = webrtcSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: "Session not found" });
  }
  return res.json({ success: true, offer: session.offer });
});

app.post('/api/webrtc/answer', (req, res) => {
  const { sessionId, answer } = req.body;
  const session = webrtcSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: "Session not found" });
  }
  session.answer = answer;
  return res.json({ success: true });
});

app.get('/api/webrtc/answer', (req, res) => {
  const { sessionId } = req.query;
  const session = webrtcSessions.get(sessionId);
  if (!session) {
    return res.status(404).json({ success: false, error: "Session not found" });
  }
  return res.json({ success: true, answer: session.answer });
});

// Periodic session cleanup
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of webrtcSessions.entries()) {
    if (now - value.timestamp > 1800000) { // 30 minutes
      webrtcSessions.delete(key);
    }
  }
}, 60000);

// Endpoint to retrieve the local network IP for WebRTC QR code
app.get('/api/network-ip', (req, res) => {
  try {
    const networkInterfaces = os.networkInterfaces();
    const addresses = [];
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
    const ip = addresses[0] || 'localhost';
    res.json({ success: true, ip });
  } catch (error) {
    res.json({ success: false, error: error.message, ip: 'localhost' });
  }
});

// Start the server
const useHttps = fs.existsSync('key.pem') && fs.existsSync('cert.pem');
const server = useHttps
  ? https.createServer({
      key: fs.readFileSync('key.pem'),
      cert: fs.readFileSync('cert.pem')
    }, app)
  : app;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[Server Error] Port ${PORT} is already in use by another running process.`);
    console.error(`To fix: Stop the other process or set PORT in .env (e.g., PORT=3001).\n`);
  } else {
    console.error('[Server Error]', err);
  }
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  const activeModel = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const networkInterfaces = os.networkInterfaces();
  const addresses = [];
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  const scheme = useHttps ? 'https' : 'http';
  console.log(`=======================================================`);
  console.log(` AI Interviewer Server running on all interfaces (0.0.0.0)`);
  console.log(` Protocol:  ${useHttps ? 'HTTPS (Secure)' : 'HTTP (Insecure - Mobile cameras might block)'}`);
  console.log(` - Local:   ${scheme}://localhost:${PORT}`);
  addresses.forEach(addr => {
    console.log(` - Network: ${scheme}://${addr}:${PORT}`);
  });
  const modeString = GROQ_API_KEY 
    ? `Groq Mode (Primary: ${activeModel}, Fallback Active)` 
    : (SECONDARY_GROQ_API_KEY ? `Groq Mode (Fallback API Key active)` : 'Offline/Mock Fallback Mode');
  console.log(` Environment: ${modeString}`);
  console.log(`=======================================================`);
});
