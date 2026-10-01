// 本地 Fork 不发行远端 server bundle；旧直接脚本须在读取配置/构建副作用之前拒绝。
throw new Error("Desktop-only: remote server distribution is unavailable");

export {};
