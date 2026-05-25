---
title: 算法
published: 2026-01-12
description: Java算法基础学习笔记，涵盖递归思想、6大算法思想（分治/动态规划/贪心/二分/搜索/回溯）、9种经典排序算法的原理分析与代码实现，以及限流算法实战，适合算法入门与面试复习使用。
tags: [JAVA, 算法]
category: JAVA
draft: false
---

> 从递归到排序，从算法思想到企业级限流：一份面向 Java 开发者的算法学习路线。重点解决"学了忘、忘了学"的问题——每个算法都给出核心思路、代码实现和适用场景，不堆砌概念。

## 引子

算法学习的典型困境：刷了 200 道题，面试时还是写不出快排的 partition；背了时间复杂度表，遇到实际问题不知道该选哪种排序。根本原因是把算法当成"知识点"在背，而不是当成"工具"在用。

本文按两条线组织：**算法思想**解决"怎么想"，**排序算法**解决"怎么排"。每个算法都包含三部分——核心思路（30 秒能说清楚）、代码实现（能跑的 Java 代码）、适用场景（什么时候用、什么时候别用）。

## 递归

### 核心思路

函数调用自身，每次传入不同的参数，直到满足终止条件后逐层返回。

递归的本质是**栈操作**：每调用一次，JVM 压入一个栈帧；每 return 一次，弹出一个栈帧。理解了栈帧的独立性和共享性，递归的大部分行为都能推导出来。

### 关键规则

1. 每次调用创建独立的栈帧，局部变量互不影响
2. 引用类型参数在栈帧间共享同一对象，修改会互相可见
3. 必须向终止条件逼近，否则 `StackOverflowError`
4. 方法执行完毕或遇到 `return`，当前栈帧弹出，返回上一层

### 代码实现

```java
public class RecursionDemo {
    public static void printDescending(int n) {
        if (n > 2) {
            printDescending(n - 1);
        }
        System.out.println("n = " + n);
    }

    public static void main(String[] args) {
        printDescending(5);
    }
}
```

执行过程：`printDescending(5)` → `printDescending(4)` → `printDescending(3)` → `printDescending(2)` 打印 2 → 返回打印 3 → 返回打印 4 → 返回打印 5。

### 适用场景

- 问题可分解为相同结构的子问题（树遍历、阶乘、斐波那契）
- 数据结构本身是递归定义的（链表、树、图）
- 需要回溯所有可能性的场景（排列组合、迷宫求解）

### 注意事项

- 递归深度受 JVM 栈大小限制（默认约 1MB，可通过 `-Xss` 调整），深度过大时改用迭代
- 存在重复计算的递归（如朴素斐波那契），必须用记忆化或改用动态规划

---

# 算法思想

[配图：算法思想知识体系总览，展示6大思想的核心关系与适用场景分类]

## 分治算法

### 核心思路

将问题拆分为**互不重叠**的子问题，分别求解后合并结果。三步走：**分解 → 求解 → 合并**。

分治的前提：子问题相互独立。如果子问题之间有重叠，应该用动态规划。

### 代码实现

```java
public class MergeSortDivideConquer {

    public static int maxSubArray(int[] nums) {
        return divide(nums, 0, nums.length - 1);
    }

    private static int divide(int[] nums, int left, int right) {
        if (left == right) {
            return nums[left];
        }
        int mid = left + (right - left) / 2;
        int leftMax = divide(nums, left, mid);
        int rightMax = divide(nums, mid + 1, right);
        int crossMax = crossMax(nums, left, mid, right);
        return Math.max(Math.max(leftMax, rightMax), crossMax);
    }

    private static int crossMax(int[] nums, int left, int mid, int right) {
        int leftSum = Integer.MIN_VALUE;
        int sum = 0;
        for (int i = mid; i >= left; i--) {
            sum += nums[i];
            leftSum = Math.max(leftSum, sum);
        }
        int rightSum = Integer.MIN_VALUE;
        sum = 0;
        for (int i = mid + 1; i <= right; i++) {
            sum += nums[i];
            rightSum = Math.max(rightSum, sum);
        }
        return leftSum + rightSum;
    }

    public static void main(String[] args) {
        int[] nums = {-2, 1, -3, 4, -1, 2, 1, -5, 4};
        System.out.println("最大子数组和: " + maxSubArray(nums));
    }
}
```

### 适用场景

- 归并排序、快速排序
- 大规模数据的并行计算（MapReduce 的理论基础）
- 最近点对问题、大整数乘法（Karatsuba）

### 注意事项

- 子问题必须相互独立，重叠子问题应改用动态规划
- 合并步骤的复杂度决定整体效率，合并代价高则分治优势不明显

---

## 动态规划算法

### 核心思路

将问题拆分为**有重叠**的子问题，用表格记录已求解的子问题结果，避免重复计算。三要素：**最优子结构 → 状态转移方程 → 边界条件**。

动态规划与分治的区别：分治的子问题互不重叠，动态规划的子问题有重叠。重叠意味着重复计算，用空间换时间记录结果。

### 解题步骤

1. 定义状态：`dp[i]` 或 `dp[i][j]` 表示什么
2. 推导状态转移方程：`dp[i]` 如何从之前的状态推导
3. 确定边界条件：`dp[0]`、`dp[1]` 等初始值
4. 确定遍历顺序：保证计算 `dp[i]` 时所需的状态已计算
5. 返回结果

### 代码实现

```java
public class DynamicProgrammingDemo {

    public static int fib(int n) {
        if (n <= 1) return n;
        int[] dp = new int[n + 1];
        dp[0] = 0;
        dp[1] = 1;
        for (int i = 2; i <= n; i++) {
            dp[i] = dp[i - 1] + dp[i - 2];
        }
        return dp[n];
    }

    public static int climbStairs(int n) {
        if (n <= 2) return n;
        int prev2 = 1, prev1 = 2;
        for (int i = 3; i <= n; i++) {
            int curr = prev1 + prev2;
            prev2 = prev1;
            prev1 = curr;
        }
        return prev1;
    }

    public static int knapsack(int[] weights, int[] values, int capacity) {
        int n = weights.length;
        int[][] dp = new int[n + 1][capacity + 1];
        for (int i = 1; i <= n; i++) {
            for (int w = 0; w <= capacity; w++) {
                dp[i][w] = dp[i - 1][w];
                if (w >= weights[i - 1]) {
                    dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - weights[i - 1]] + values[i - 1]);
                }
            }
        }
        return dp[n][capacity];
    }

    public static void main(String[] args) {
        System.out.println("斐波那契(10): " + fib(10));
        System.out.println("爬楼梯(10): " + climbStairs(10));
        int[] w = {1, 3, 4, 5};
        int[] v = {1, 4, 5, 7};
        System.out.println("0-1背包(容量7): " + knapsack(w, v, 7));
    }
}
```

### 适用场景

- 最优化问题：最大/最小/最长/最短
- 计数问题：有多少种方案
- 存在重叠子问题的场景

### 注意事项

- 状态转移方程是核心，推导不出来就画表格手动模拟前几步
- 空间优化：如果 `dp[i]` 只依赖 `dp[i-1]` 和 `dp[i-2]`，可以用滚动变量替代数组，空间从 O(n) 降到 O(1)
- 二维 dp 如果只依赖上一行，可以压缩为一维数组

---

## 贪心算法

### 核心思路

每一步选择当前看起来最优的选项，不回头。贪心不保证全局最优，但在特定问题上能给出正确解。

贪心有效的条件：**贪心选择性质**（局部最优能推导出全局最优）+ **最优子结构**（问题的最优解包含子问题的最优解）。

### 代码实现

```java
import java.util.*;

public class GreedyDemo {

    public static int activitySelection(int[][] activities) {
        Arrays.sort(activities, Comparator.comparingInt(a -> a[1]));
        int count = 1;
        int lastEnd = activities[0][1];
        for (int i = 1; i < activities.length; i++) {
            if (activities[i][0] >= lastEnd) {
                count++;
                lastEnd = activities[i][1];
            }
        }
        return count;
    }

    public static int coinChange(int[] coins, int amount) {
        Arrays.sort(coins);
        int count = 0;
        for (int i = coins.length - 1; i >= 0; i--) {
            while (amount >= coins[i]) {
                amount -= coins[i];
                count++;
            }
        }
        return amount == 0 ? count : -1;
    }

    public static void main(String[] args) {
        int[][] activities = {{1, 3}, {2, 5}, {3, 9}, {0, 6}, {5, 7}, {8, 10}};
        System.out.println("最多活动数: " + activitySelection(activities));

        int[] coins = {1, 5, 10, 25};
        System.out.println("最少硬币数(41分): " + coinChange(coins, 41));
    }
}
```

### 适用场景

- 活动选择问题、区间调度
- 霍夫曼编码、最小生成树（Prim/Kruskal）
- 最短路径（Dijkstra）
- 硬币找零（硬币面额满足贪心条件时）

### 注意事项

- 贪心不保证全局最优。硬币面额为 `{1, 3, 4}`，找 6 分：贪心给出 4+1+1=3 枚，最优解为 3+3=2 枚
- 使用前必须证明贪心选择性质，否则结果可能错误

---

## 二分法

### 核心思路

在**有序**区间上，每次将搜索范围缩小一半。前提条件：区间具有**单调性**或**可二段性**。

二分法的本质不是"找目标值"，而是"找到满足某个条件的边界"。理解了这一点，变体题都能统一处理。

### 代码实现

```java
public class BinarySearchDemo {

    public static int binarySearch(int[] nums, int target) {
        int left = 0, right = nums.length - 1;
        while (left <= right) {
            int mid = left + (right - left) / 2;
            if (nums[mid] == target) {
                return mid;
            } else if (nums[mid] < target) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return -1;
    }

    public static int lowerBound(int[] nums, int target) {
        int left = 0, right = nums.length;
        while (left < right) {
            int mid = left + (right - left) / 2;
            if (nums[mid] < target) {
                left = mid + 1;
            } else {
                right = mid;
            }
        }
        return left;
    }

    public static int searchInsert(int[] nums, int target) {
        int left = 0, right = nums.length - 1;
        while (left <= right) {
            int mid = left + (right - left) / 2;
            if (nums[mid] == target) {
                return mid;
            } else if (nums[mid] < target) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return left;
    }

    public static void main(String[] args) {
        int[] nums = {1, 3, 5, 7, 9, 11};
        System.out.println("查找7的位置: " + binarySearch(nums, 7));
        System.out.println("第一个>=5的位置: " + lowerBound(nums, 5));
        System.out.println("插入6的位置: " + searchInsert(nums, 6));
    }
}
```

### 适用场景

- 有序数组查找
- 求满足条件的最大/最小值（答案二分）
- 旋转数组、寻找峰值等变体

### 注意事项

- `mid = left + (right - left) / 2` 防止 `left + right` 整数溢出
- 循环条件 `left <= right` 和 `left < right` 的区别：前者用于精确查找，后者用于查找边界
- 区间开闭要统一：`[left, right]` 还是 `[left, right)`，决定了 `left` 和 `right` 的更新方式

---

## 搜索算法

### 核心思路

系统性地遍历状态空间，找到目标状态。两大策略：

- **BFS（广度优先搜索）**：逐层扩展，用队列实现。特点：最先找到的路径一定最短
- **DFS（深度优先搜索）**：一条路走到底，用栈（或递归）实现。特点：空间效率高，适合找所有解

[配图：BFS与DFS遍历顺序对比图，展示队列和栈的执行过程]

### 代码实现

```java
import java.util.*;

public class SearchDemo {

    public static int bfs(int[][] grid) {
        int rows = grid.length, cols = grid[0].length;
        boolean[][] visited = new boolean[rows][cols];
        Queue<int[]> queue = new LinkedList<>();
        queue.offer(new int[]{0, 0});
        visited[0][0] = true;
        int steps = 0;
        int[][] dirs = {{0, 1}, {1, 0}, {0, -1}, {-1, 0}};

        while (!queue.isEmpty()) {
            int size = queue.size();
            for (int i = 0; i < size; i++) {
                int[] cur = queue.poll();
                if (cur[0] == rows - 1 && cur[1] == cols - 1) {
                    return steps;
                }
                for (int[] d : dirs) {
                    int nr = cur[0] + d[0], nc = cur[1] + d[1];
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols
                            && !visited[nr][nc] && grid[nr][nc] == 0) {
                        visited[nr][nc] = true;
                        queue.offer(new int[]{nr, nc});
                    }
                }
            }
            steps++;
        }
        return -1;
    }

    public static List<String> dfsPaths(int[][] grid) {
        List<String> paths = new ArrayList<>();
        boolean[][] visited = new boolean[grid.length][grid[0].length];
        dfsHelper(grid, 0, 0, "", visited, paths);
        return paths;
    }

    private static void dfsHelper(int[][] grid, int r, int c, String path,
                                   boolean[][] visited, List<String> paths) {
        int rows = grid.length, cols = grid[0].length;
        if (r < 0 || r >= rows || c < 0 || c >= cols || visited[r][c] || grid[r][c] == 1) {
            return;
        }
        path += "(" + r + "," + c + ") ";
        if (r == rows - 1 && c == cols - 1) {
            paths.add(path.trim());
            return;
        }
        visited[r][c] = true;
        dfsHelper(grid, r, c + 1, path, visited, paths);
        dfsHelper(grid, r + 1, c, path, visited, paths);
        dfsHelper(grid, r, c - 1, path, visited, paths);
        dfsHelper(grid, r - 1, c, path, visited, paths);
        visited[r][c] = false;
    }

    public static void main(String[] args) {
        int[][] grid = {
            {0, 0, 0},
            {0, 1, 0},
            {0, 0, 0}
        };
        System.out.println("BFS最短路径步数: " + bfs(grid));
        System.out.println("DFS所有路径: " + dfsPaths(grid));
    }
}
```

### 适用场景

| 算法 | 数据结构 | 空间复杂度 | 适用场景 |
|------|----------|-----------|---------|
| BFS | 队列 | O(宽度的最大值) | 最短路径、层级遍历、状态空间最小步数 |
| DFS | 栈/递归 | O(深度) | 所有路径、拓扑排序、连通分量、回溯 |

### 注意事项

- BFS 找最短路径的前提：所有边权重相同。权重不同用 Dijkstra
- DFS 的 `visited` 回溯时需要重置为 `false`，BFS 不需要（BFS 每个节点只入队一次）
- 网格搜索中，方向数组 `{{0,1},{1,0},{0,-1},{-1,0}}` 是通用模板

---

## 回溯算法

### 核心思路

在 DFS 的基础上增加**撤销选择**的步骤。本质是带剪枝的穷举：尝试所有可能性，走不通就回退一步换条路。

回溯的框架固定：**做选择 → 递归 → 撤销选择**。掌握框架后，题目之间的区别只在"选择列表"和"终止条件"。

### 代码实现

```java
import java.util.*;

public class BacktrackDemo {

    public static List<List<Integer>> permute(int[] nums) {
        List<List<Integer>> result = new ArrayList<>();
        backtrack(nums, new ArrayList<>(), result, new boolean[nums.length]);
        return result;
    }

    private static void backtrack(int[] nums, List<Integer> path,
                                   List<List<Integer>> result, boolean[] used) {
        if (path.size() == nums.length) {
            result.add(new ArrayList<>(path));
            return;
        }
        for (int i = 0; i < nums.length; i++) {
            if (used[i]) continue;
            path.add(nums[i]);
            used[i] = true;
            backtrack(nums, path, result, used);
            path.remove(path.size() - 1);
            used[i] = false;
        }
    }

    public static List<List<Integer>> combine(int n, int k) {
        List<List<Integer>> result = new ArrayList<>();
        combineHelper(n, k, 1, new ArrayList<>(), result);
        return result;
    }

    private static void combineHelper(int n, int k, int start,
                                       List<Integer> path, List<List<Integer>> result) {
        if (path.size() == k) {
            result.add(new ArrayList<>(path));
            return;
        }
        for (int i = start; i <= n - (k - path.size()) + 1; i++) {
            path.add(i);
            combineHelper(n, k, i + 1, path, result);
            path.remove(path.size() - 1);
        }
    }

    public static void main(String[] args) {
        System.out.println("全排列 [1,2,3]: " + permute(new int[]{1, 2, 3}));
        System.out.println("组合 C(4,2): " + combine(4, 2));
    }
}
```

### 适用场景

- 排列、组合、子集问题
- N 皇后、数独
- 所有可行解的枚举

### 注意事项

- 剪枝是提升效率的关键：`i <= n - (k - path.size()) + 1` 跳过不可能凑够 k 个的组合
- `result.add(new ArrayList<>(path))` 必须创建新列表，否则所有结果指向同一个引用
- 回溯的时间复杂度通常是指数级，数据规模超过 20 时需要考虑其他方案

---

# 排序算法

[配图：排序算法知识体系总览，按比较排序/非比较排序分类，标注时间复杂度]

## 冒泡排序（Bubble Sort）

### 核心思路

相邻元素两两比较，将较大的元素逐步"冒泡"到数组末尾。每轮确定一个最大值的位置。

### 代码实现

```java
public class BubbleSort {

    public static void bubbleSort(int[] a) {
        int n = a.length;
        for (int i = n - 1; i > 0; i--) {
            boolean swapped = false;
            for (int j = 0; j < i; j++) {
                if (a[j] > a[j + 1]) {
                    int tmp = a[j];
                    a[j] = a[j + 1];
                    a[j + 1] = tmp;
                    swapped = true;
                }
            }
            if (!swapped) break;
        }
    }

    public static void main(String[] args) {
        int[] a = {20, 40, 30, 10, 60, 50};
        bubbleSort(a);
        System.out.println(java.util.Arrays.toString(a));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n)（已有序，flag 优化后一轮退出） |
| 最坏时间 | O(n²) |
| 平均时间 | O(n²) |
| 空间 | O(1) |
| 稳定性 | 稳定 |

### 适用场景

- 数据量小（n < 50）或基本有序时效率可接受
- 教学演示，实际工程中几乎不使用

---

## 快速排序（Quick Sort）

### 核心思路

选一个基准值（pivot），将数组分为小于 pivot 和大于 pivot 两部分，对两部分递归排序。

快排的核心在 partition 操作：双指针从两端向中间扫描，保证 pivot 左边都小、右边都大。

### 代码实现

```java
import java.util.Arrays;

public class QuickSort {

    public static void quickSort(int[] arr, int low, int high) {
        if (low < high) {
            int pivotIndex = partition(arr, low, high);
            quickSort(arr, low, pivotIndex - 1);
            quickSort(arr, pivotIndex + 1, high);
        }
    }

    private static int partition(int[] arr, int low, int high) {
        int pivot = arr[high];
        int i = low - 1;
        for (int j = low; j < high; j++) {
            if (arr[j] <= pivot) {
                i++;
                int tmp = arr[i];
                arr[i] = arr[j];
                arr[j] = tmp;
            }
        }
        int tmp = arr[i + 1];
        arr[i + 1] = arr[high];
        arr[high] = tmp;
        return i + 1;
    }

    public static void main(String[] args) {
        int[] arr = {10, 7, 8, 9, 1, 5};
        quickSort(arr, 0, arr.length - 1);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n log n) |
| 最坏时间 | O(n²)（数组已有序且 pivot 选最值） |
| 平均时间 | O(n log n) |
| 空间 | O(log n)（递归栈） |
| 稳定性 | 不稳定 |

### 适用场景

- 通用排序的首选，Java `Arrays.sort()` 对基本类型使用双轴快排
- 数据量大、内存排序场景

### 注意事项

- 最坏情况 O(n²) 的应对：随机选 pivot 或三数取中
- 递归深度 O(log n)，数据量极大时考虑迭代实现避免栈溢出

---

## 插入排序（Insertion Sort）

### 核心思路

将数组分为已排序和未排序两部分，每次从未排序部分取一个元素，插入到已排序部分的正确位置。

类似打扑克牌：每摸一张牌，插入手中已有牌的正确位置。

### 代码实现

```java
import java.util.Arrays;

public class InsertionSort {

    public static void insertionSort(int[] arr) {
        for (int i = 1; i < arr.length; i++) {
            int key = arr[i];
            int j = i - 1;
            while (j >= 0 && arr[j] > key) {
                arr[j + 1] = arr[j];
                j--;
            }
            arr[j + 1] = key;
        }
    }

    public static void main(String[] args) {
        int[] arr = {12, 11, 13, 5, 6};
        insertionSort(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n)（已有序） |
| 最坏时间 | O(n²) |
| 平均时间 | O(n²) |
| 空间 | O(1) |
| 稳定性 | 稳定 |

### 适用场景

- 数据量小或基本有序（Java `Arrays.sort()` 对小数组用插入排序作为快排的收尾）
- 链表排序（插入操作只需修改指针，不需要移动元素）

---

## 希尔排序（Shell Sort）

### 核心思路

插入排序的改进版。先按较大间隔分组做插入排序，让元素快速接近最终位置；逐步缩小间隔，最后间隔为 1 时就是标准插入排序。

间隔序列的选择影响效率，常用 Knuth 序列：`gap = gap * 3 + 1`（1, 4, 13, 40, ...）。

### 代码实现

```java
import java.util.Arrays;

public class ShellSort {

    public static void shellSort(int[] arr) {
        int n = arr.length;
        int gap = 1;
        while (gap < n / 3) {
            gap = gap * 3 + 1;
        }
        while (gap >= 1) {
            for (int i = gap; i < n; i++) {
                int key = arr[i];
                int j = i;
                while (j >= gap && arr[j - gap] > key) {
                    arr[j] = arr[j - gap];
                    j -= gap;
                }
                arr[j] = key;
            }
            gap /= 3;
        }
    }

    public static void main(String[] args) {
        int[] arr = {9, 8, 7, 6, 5, 4, 3, 2, 1};
        shellSort(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n log n) |
| 最坏时间 | O(n²)（取决于间隔序列） |
| 平均时间 | O(n^1.3)（Knuth 序列经验值） |
| 空间 | O(1) |
| 稳定性 | 不稳定 |

### 适用场景

- 中等规模数据，对稳定性无要求
- 嵌入式场景：代码简单、不需要额外空间、比插入排序快

---

## 选择排序（Selection Sort）

### 核心思路

每轮从未排序部分选出最小元素，放到已排序部分的末尾。与冒泡的区别：冒泡通过交换逐步移动，选择排序直接定位最小值后一次交换。

### 代码实现

```java
import java.util.Arrays;

public class SelectionSort {

    public static void selectionSort(int[] arr) {
        int n = arr.length;
        for (int i = 0; i < n - 1; i++) {
            int minIdx = i;
            for (int j = i + 1; j < n; j++) {
                if (arr[j] < arr[minIdx]) {
                    minIdx = j;
                }
            }
            if (minIdx != i) {
                int tmp = arr[i];
                arr[i] = arr[minIdx];
                arr[minIdx] = tmp;
            }
        }
    }

    public static void main(String[] args) {
        int[] arr = {64, 25, 12, 22, 11};
        selectionSort(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n²) |
| 最坏时间 | O(n²) |
| 平均时间 | O(n²) |
| 空间 | O(1) |
| 稳定性 | 不稳定 |

### 适用场景

- 数据量小，且交换代价远大于比较代价（选择排序每轮最多交换一次）
- 实际工程中极少使用，性能不如插入排序

---

## 堆排序（Heap Sort）

### 核心思路

利用堆这种数据结构排序。先将数组建成最大堆，堆顶元素就是最大值；将堆顶与末尾交换，缩小堆的范围，重新调整堆，重复直到堆为空。

堆排序的核心操作是 `heapify`（下沉调整）：从某个节点开始，确保以该节点为根的子树满足堆性质。

### 代码实现

```java
import java.util.Arrays;

public class HeapSort {

    public static void heapSort(int[] arr) {
        int n = arr.length;
        for (int i = n / 2 - 1; i >= 0; i--) {
            heapify(arr, n, i);
        }
        for (int i = n - 1; i > 0; i--) {
            int tmp = arr[0];
            arr[0] = arr[i];
            arr[i] = tmp;
            heapify(arr, i, 0);
        }
    }

    private static void heapify(int[] arr, int n, int i) {
        int largest = i;
        int left = 2 * i + 1;
        int right = 2 * i + 2;
        if (left < n && arr[left] > arr[largest]) {
            largest = left;
        }
        if (right < n && arr[right] > arr[largest]) {
            largest = right;
        }
        if (largest != i) {
            int tmp = arr[i];
            arr[i] = arr[largest];
            arr[largest] = tmp;
            heapify(arr, n, largest);
        }
    }

    public static void main(String[] args) {
        int[] arr = {12, 11, 13, 5, 6, 7};
        heapSort(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n log n) |
| 最坏时间 | O(n log n) |
| 平均时间 | O(n log n) |
| 空间 | O(1) |
| 稳定性 | 不稳定 |

### 适用场景

- 需要保证最坏情况也是 O(n log n) 的场景
- 只需要前 k 大/小的元素（建堆后取 k 次，O(n + k log n)）
- 优先队列的底层实现

### 注意事项

- 堆排序的缓存不友好：堆操作跳跃式访问数组元素，对 CPU 缓存不友好，实际运行速度比快排慢
- Java `PriorityQueue` 默认最小堆，需要最大堆时传入 `Collections.reverseOrder()`

---

## 归并排序（Merge Sort）

### 核心思路

将数组递归地分成两半，分别排序后合并。合并操作是核心：两个有序数组合并为一个有序数组。

归并排序是分治思想的典型应用，也是唯一稳定且保证 O(n log n) 的比较排序。

### 代码实现

```java
import java.util.Arrays;

public class MergeSort {

    public static void mergeSort(int[] arr, int left, int right) {
        if (left < right) {
            int mid = left + (right - left) / 2;
            mergeSort(arr, left, mid);
            mergeSort(arr, mid + 1, right);
            merge(arr, left, mid, right);
        }
    }

    private static void merge(int[] arr, int left, int mid, int right) {
        int[] temp = new int[right - left + 1];
        int i = left, j = mid + 1, k = 0;
        while (i <= mid && j <= right) {
            if (arr[i] <= arr[j]) {
                temp[k++] = arr[i++];
            } else {
                temp[k++] = arr[j++];
            }
        }
        while (i <= mid) {
            temp[k++] = arr[i++];
        }
        while (j <= right) {
            temp[k++] = arr[j++];
        }
        System.arraycopy(temp, 0, arr, left, temp.length);
    }

    public static void main(String[] args) {
        int[] arr = {38, 27, 43, 3, 9, 82, 10};
        mergeSort(arr, 0, arr.length - 1);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n log n) |
| 最坏时间 | O(n log n) |
| 平均时间 | O(n log n) |
| 空间 | O(n) |
| 稳定性 | 稳定 |

### 适用场景

- 需要稳定排序且数据量大（Java `Arrays.sort()` 对对象数组用 TimSort，归并排序的变体）
- 外部排序：数据量超过内存时，分批加载排序后归并
- 链表排序（归并排序不需要随机访问，天然适合链表）

### 注意事项

- 空间 O(n) 是归并排序的主要代价，不适合内存紧张的场景
- `arr[i] <= arr[j]` 保证稳定性，写成 `<` 会变成不稳定排序

---

## 桶排序（Bucket Sort）

### 核心思路

将元素按值范围分配到若干个桶中，每个桶内部用其他排序算法（通常是插入排序）排序，最后按桶顺序合并。

桶排序是非比较排序，效率取决于数据分布是否均匀。

### 代码实现

```java
import java.util.*;

public class BucketSort {

    public static void bucketSort(int[] arr, int bucketCount) {
        if (arr.length == 0) return;
        int maxVal = arr[0], minVal = arr[0];
        for (int val : arr) {
            maxVal = Math.max(maxVal, val);
            minVal = Math.min(minVal, val);
        }
        int range = maxVal - minVal + 1;
        int bucketSize = (range + bucketCount - 1) / bucketCount;

        List<List<Integer>> buckets = new ArrayList<>();
        for (int i = 0; i < bucketCount; i++) {
            buckets.add(new ArrayList<>());
        }

        for (int val : arr) {
            int idx = Math.min((val - minVal) / bucketSize, bucketCount - 1);
            buckets.get(idx).add(val);
        }

        int index = 0;
        for (List<Integer> bucket : buckets) {
            Collections.sort(bucket);
            for (int val : bucket) {
                arr[index++] = val;
            }
        }
    }

    public static void main(String[] args) {
        int[] arr = {42, 32, 33, 52, 37, 47, 51};
        bucketSort(arr, 3);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 最好时间 | O(n + k)（k 为桶数，数据均匀分布） |
| 最坏时间 | O(n²)（所有元素分到同一个桶） |
| 平均时间 | O(n + k) |
| 空间 | O(n + k) |
| 稳定性 | 稳定（取决于桶内排序算法） |

### 适用场景

- 数据分布均匀且范围已知
- 外部排序：每个桶写入一个文件，文件内排序后归并

### 注意事项

- 数据分布不均匀时退化为 O(n²)，桶排序失效
- 桶数量需要根据数据特征调整，过多浪费空间，过少退化为桶内排序

---

## 基数排序（Radix Sort）

### 核心思路

按位排序：从最低位到最高位，对每一位做稳定排序（通常用计数排序）。核心思想：低位排序的结果在高位排序时保持不变（依赖稳定性）。

基数排序是非比较排序，时间复杂度与位数相关，与元素大小无关。

### 代码实现

```java
import java.util.Arrays;

public class RadixSort {

    public static void radixSort(int[] arr) {
        if (arr.length == 0) return;
        int max = arr[0];
        for (int val : arr) {
            max = Math.max(max, Math.abs(val));
        }
        for (int exp = 1; max / exp > 0; exp *= 10) {
            countingSortByDigit(arr, exp);
        }
    }

    private static void countingSortByDigit(int[] arr, int exp) {
        int[] output = new int[arr.length];
        int[] count = new int[10];

        for (int val : arr) {
            int digit = (Math.abs(val) / exp) % 10;
            count[digit]++;
        }

        for (int i = 1; i < 10; i++) {
            count[i] += count[i - 1];
        }

        for (int i = arr.length - 1; i >= 0; i--) {
            int digit = (Math.abs(arr[i]) / exp) % 10;
            output[count[digit] - 1] = arr[i];
            count[digit]--;
        }

        System.arraycopy(output, 0, arr, 0, arr.length);
    }

    public static void main(String[] args) {
        int[] arr = {170, 45, 75, 90, 802, 24, 2, 66};
        radixSort(arr);
        System.out.println(Arrays.toString(arr));
    }
}
```

### 复杂度

| 指标 | 值 |
|------|-----|
| 时间 | O(d × (n + k))，d 为位数，k 为基数（通常 10） |
| 空间 | O(n + k) |
| 稳定性 | 稳定 |

### 适用场景

- 数据量大、位数固定（如手机号、身份证号排序）
- 字符串排序（按字符逐位处理）

### 注意事项

- 仅适用于整数或可按位拆分的数据，浮点数和复杂对象不适用
- 处理负数需要额外逻辑（分离正负部分分别排序，或用偏移量映射）

---

## 排序算法综合对比

| 算法 | 平均时间 | 最坏时间 | 空间 | 稳定 | 类型 |
|------|---------|---------|------|------|------|
| 冒泡排序 | O(n²) | O(n²) | O(1) | ✅ | 比较 |
| 选择排序 | O(n²) | O(n²) | O(1) | ❌ | 比较 |
| 插入排序 | O(n²) | O(n²) | O(1) | ✅ | 比较 |
| 希尔排序 | O(n^1.3) | O(n²) | O(1) | ❌ | 比较 |
| 快速排序 | O(n log n) | O(n²) | O(log n) | ❌ | 比较 |
| 堆排序 | O(n log n) | O(n log n) | O(1) | ❌ | 比较 |
| 归并排序 | O(n log n) | O(n log n) | O(n) | ✅ | 比较 |
| 桶排序 | O(n + k) | O(n²) | O(n + k) | ✅ | 非比较 |
| 基数排序 | O(d(n + k)) | O(d(n + k)) | O(n + k) | ✅ | 非比较 |

### 选择策略

1. **数据量小（n < 50）**：插入排序，实现简单、常数因子小
2. **数据量大、通用场景**：快速排序，平均最快、缓存友好
3. **需要稳定排序**：归并排序（或 TimSort）
4. **需要保证最坏 O(n log n)**：堆排序或归并排序
5. **数据分布均匀、范围已知**：桶排序
6. **位数固定的整数**：基数排序

### Java 标准库的选择

- `Arrays.sort(int[])`：双轴快排（基本类型，不需要稳定性）
- `Arrays.sort(Object[])`：TimSort（对象类型，需要稳定性，归并+插入的混合）
- `Collections.sort()`：底层调用 `Arrays.sort()`，TimSort

---

# 限流算法

## 令牌桶算法

### 核心思路

系统以恒定速率向桶中放入令牌，桶满则停止。每次请求消耗一个令牌，桶空则拒绝。令牌桶允许突发流量：桶中积累的令牌可以一次性消耗。

### 代码实现

```java
public class TokenBucketRateLimiter {

    private final long capacity;
    private final double refillRate;
    private volatile double tokens;
    private long lastRefillTime;

    public TokenBucketRateLimiter(long capacity, double refillRate) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefillTime = System.nanoTime();
    }

    public synchronized boolean tryAcquire() {
        refill();
        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }
        return false;
    }

    public synchronized boolean tryAcquire(int permits) {
        refill();
        if (tokens >= permits) {
            tokens -= permits;
            return true;
        }
        return false;
    }

    private void refill() {
        long now = System.nanoTime();
        double elapsed = (now - lastRefillTime) / 1_000_000_000.0;
        tokens = Math.min(capacity, tokens + elapsed * refillRate);
        lastRefillTime = now;
    }

    public static void main(String[] args) throws InterruptedException {
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(10, 2);
        for (int i = 0; i < 15; i++) {
            boolean allowed = limiter.tryAcquire();
            System.out.println("请求 " + (i + 1) + ": " + (allowed ? "通过" : "拒绝"));
        }
        Thread.sleep(1000);
        System.out.println("--- 等待1秒后 ---");
        for (int i = 0; i < 5; i++) {
            boolean allowed = limiter.tryAcquire();
            System.out.println("请求 " + (i + 1) + ": " + (allowed ? "通过" : "拒绝"));
        }
    }
}
```

### 适用场景

- 允许短时突发的 API 限流（如用户请求）
- Guava `RateLimiter` 就是令牌桶实现

---

## 漏桶算法

### 核心思路

请求流入桶中，桶以固定速率漏水（处理请求）。桶满时新请求被丢弃。无论请求到达速率如何，处理速率始终恒定。

### 代码实现

```java
public class LeakyBucketRateLimiter {

    private final long capacity;
    private final double leakRate;
    private volatile double water;
    private long lastLeakTime;

    public LeakyBucketRateLimiter(long capacity, double leakRate) {
        this.capacity = capacity;
        this.leakRate = leakRate;
        this.water = 0;
        this.lastLeakTime = System.nanoTime();
    }

    public synchronized boolean tryAcquire() {
        leak();
        if (water < capacity) {
            water += 1;
            return true;
        }
        return false;
    }

    private void leak() {
        long now = System.nanoTime();
        double elapsed = (now - lastLeakTime) / 1_000_000_000.0;
        water = Math.max(0, water - elapsed * leakRate);
        lastLeakTime = now;
    }

    public synchronized long getWaitTimeMs() {
        leak();
        if (water < 1) return 0;
        return (long) ((water / leakRate) * 1000);
    }

    public static void main(String[] args) throws InterruptedException {
        LeakyBucketRateLimiter limiter = new LeakyBucketRateLimiter(5, 1);
        System.out.println("--- 突发10个请求 ---");
        for (int i = 0; i < 10; i++) {
            boolean allowed = limiter.tryAcquire();
            System.out.println("请求 " + (i + 1) + ": " + (allowed ? "通过" : "丢弃"));
        }
        System.out.println("--- 等待3秒后 ---");
        Thread.sleep(3000);
        for (int i = 0; i < 5; i++) {
            boolean allowed = limiter.tryAcquire();
            System.out.println("请求 " + (i + 1) + ": " + (allowed ? "通过" : "丢弃"));
        }
    }
}
```

### 适用场景

- 严格限速场景（网络流量整形、消息队列消费速率控制）

---

## 令牌桶 vs 漏桶对比

| 特性 | 令牌桶 | 漏桶 |
|------|--------|------|
| 突发流量 | 允许（桶中积累的令牌可一次性消耗） | 不允许（严格匀速处理） |
| 输出速率 | 可变（有令牌时可快速处理） | 恒定 |
| 适用场景 | 允许短时突发，如用户请求 | 严格限速，如网络流量整形 |
| 实现复杂度 | 需维护令牌生成和消耗 | 相对简单 |

---

# 实战项目

## 判断版本号是否连续

利用等差数列求和公式做数学判定，无需遍历区间：

1. 去重后，若版本号是连续无断层的整数序列，则满足：总和 = (最小值 + 最大值) × 元素个数 / 2
2. 若实际总和 ≠ 公式计算的总和 → 存在断层
3. 重复版本号通过「原始列表大小 - 去重后大小 > 0」快速判定

```java
import java.util.*;

public class MathSumVersionValidator {

    public static SimpleCheckResult quickValidate(List<Integer> versionList) {
        if (versionList == null || versionList.isEmpty()) {
            return new SimpleCheckResult(false, false, false);
        }

        Set<Integer> unique = new HashSet<>(versionList);
        boolean hasDuplicate = versionList.size() > unique.size();
        if (unique.size() == 1) {
            return new SimpleCheckResult(true, hasDuplicate, true);
        }

        int min = Collections.min(unique);
        int max = Collections.max(unique);
        long expectedSum = (long) (min + max) * unique.size() / 2;
        long actualSum = unique.stream().mapToLong(Integer::longValue).sum();

        boolean isContinuous = expectedSum == actualSum;
        return new SimpleCheckResult(true, hasDuplicate, isContinuous);
    }

    public static class SimpleCheckResult {
        private final boolean isValid;
        private final boolean hasDuplicate;
        private final boolean isContinuous;

        public SimpleCheckResult(boolean isValid, boolean hasDuplicate, boolean isContinuous) {
            this.isValid = isValid;
            this.hasDuplicate = hasDuplicate;
            this.isContinuous = isContinuous;
        }

        @Override
        public String toString() {
            return "数学求和校验法结果：\n" +
                    "1. 是否有重复版本号：" + (hasDuplicate ? "是" : "否") + "\n" +
                    "2. 是否连续无断层：" + (isContinuous ? "是" : "否");
        }
    }

    public static void main(String[] args) {
        List<Integer> list1 = Arrays.asList(1, 2, 2, 4, 5);
        List<Integer> list2 = Arrays.asList(1, 2, 3, 4);
        System.out.println(quickValidate(list1));
        System.out.println("---");
        System.out.println(quickValidate(list2));
    }
}
```

时间复杂度 O(n)，空间复杂度 O(n)（去重用 HashSet）。

---

## 总结

1. **算法思想是元知识**：分治解决"怎么拆"，动态规划解决"怎么记"，贪心解决"怎么选"，二分解决"怎么找"，搜索解决"怎么遍"，回溯解决"怎么穷举"
2. **排序算法选型看场景**：小数据用插入，通用用快排，要稳定用归并，要保证最坏用堆排，特殊数据用桶/基数
3. **限流算法选型看需求**：允许突发用令牌桶，严格匀速用漏桶
4. **学习路线建议**：先掌握递归 → 再学6大思想 → 最后刷排序算法。思想是内功，排序是招式

## 参考资料

- 《算法导论》（CLRS）第三版
- 《数据结构与算法分析》（Mark Allen Weiss）
- Java `Arrays.sort()` 源码（OpenJDK）
- Guava RateLimiter 源码

---
> 如果这篇文章对你有帮助，欢迎点赞收藏。有问题欢迎评论区交流。
