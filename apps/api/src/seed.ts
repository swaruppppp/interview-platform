import { ProblemModel } from "./models.js";

export async function seedProblemsIfEmpty() {
  const count = await ProblemModel.countDocuments();
  if (count > 0) return;

  await ProblemModel.create([
    {
      slug: "two-sum-indices",
      title: "Two Sum (Stdin/Stdout)",
      difficulty: "Easy",
      description:
        "Given an integer N, a target T, and N integers on the second line, print the 0-based indices i j (i < j) of the two numbers that sum to T.",
      timeLimitMs: 2000,
      starterCode: {
        cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n, target;\n    cin >> n >> target;\n    vector<int> a(n);\n    for (int &x : a) cin >> x;\n    // Write your solution here\n    return 0;\n}`,
        python: `n, target = map(int, input().split())\na = list(map(int, input().split()))\n# Write your solution here\n`,
        javascript: `const fs = require("fs");\nconst tokens = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);\nconst [n, target, ...a] = tokens;\n// Write your solution here\n`,
      },
      testCases: [
        { id: "tc-1", input: "4 9\n2 7 11 15\n", expectedOutput: "0 1", isHidden: false },
        { id: "tc-2", input: "3 6\n3 2 4\n", expectedOutput: "1 2", isHidden: false },
        { id: "tc-3", input: "5 -8\n-1 -2 -3 -4 -5\n", expectedOutput: "2 4", isHidden: true },
        { id: "tc-4", input: "2 1000000000\n500000000 500000000\n", expectedOutput: "0 1", isHidden: true },
      ],
    },
    {
      slug: "subarray-sum-k",
      title: "Subarray Sum Equals K",
      difficulty: "Medium",
      description:
        "Given N and K on line 1, and N integers on line 2, print the total number of contiguous subarrays whose sum equals K.",
      timeLimitMs: 2000,
      starterCode: {
        cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    int n; long long k;\n    cin >> n >> k;\n    vector<long long> a(n);\n    for (auto &x : a) cin >> x;\n    // Write your solution here\n    return 0;\n}`,
        python: `n, k = map(int, input().split())\na = list(map(int, input().split()))\n# Write your solution here\n`,
        javascript: `const fs = require("fs");\nconst tokens = fs.readFileSync(0, "utf8").trim().split(/\\s+/).map(Number);\nconst [n, k, ...a] = tokens;\n// Write your solution here\n`,
      },
      testCases: [
        { id: "tc-1", input: "3 2\n1 1 1\n", expectedOutput: "2", isHidden: false },
        { id: "tc-2", input: "3 3\n1 2 3\n", expectedOutput: "2", isHidden: false },
        { id: "tc-3", input: "4 0\n1 -1 1 -1\n", expectedOutput: "4", isHidden: true },
      ],
    },
  ]);
  console.log("[api] Seeded starter DSA problems");
}
