; ইনস্টলের সময় Windows ফায়ারওয়ালে অনুমতি যোগ করা হয়, যাতে মোবাইল সরাসরি যুক্ত হতে পারে
!macro customInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Likhon Board"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Likhon Board" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any'
!macroend

!macro customUnInstall
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Likhon Board"'
!macroend
