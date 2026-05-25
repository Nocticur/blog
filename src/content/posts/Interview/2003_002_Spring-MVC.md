---
title: Spring-MVC
published: 2026-01-24
description: 梳理Spring MVC的核心执行流程，对比传统JSP版本与现代注解版本的请求处理机制，详细讲解DispatcherServlet前端控制器、HandlerMapping处理器映射器、HandlerAdapter处理器适配器以及HttpMessageConverter消息转换器在请求处理链路中的职责与协作关系。
tags: [JAVA, Spring-MVC]
category: 面试
draft: false
---

# 执行流程
## jsp版本
- 前端控制器（DispatcherServlet）
	接受请求，响应结构，转发
- 处理器映射器（HandlerMapping）
	根据你的url找到你的Java方法，例如：配置文件方式，实现接口方式，注解方式
- 处理器适配器（HandlerAdapter）
	说人话就是前面的组件定位到具体Java方法后，用来执行Java方法的组件
- 视图解析器（ViewResolver）
	对controller生成的值进行解析，给你的渲染视图用的
![](./image/2003_000_Spring-MVC.assets/2003_000_Spring-MVC-20260104201129.png)

## 目前版本
1. 用户发送出请求到前端控制器DispatcherServlet
2. DispatcherServlet收到请求调用HandlerMapping（处理器映射器）
3. HandlerMapping找到具体的处理器，生成处理器对象及处理器拦截器（如果有），再一起返回给DispatcherServlet。
4. DispatcherServlet调用HandlerAdapter（处理器适配器）
5. HandlerAdapter经过适配调用具体的处理器（Handler/Controller）
6. 方法上添加了@ResponseBody
7. 通过HttpMessageConverter来返回结果转换为JSON并响应
![](./image/2003_000_Spring-MVC.assets/2003_000_Spring-MVC-20260104202546.png)
