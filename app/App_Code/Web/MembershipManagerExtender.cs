using System;
using System.ComponentModel;
using System.Web.UI;
using System.Web.UI.HtmlControls;

namespace TaskManager.Web
{
	[TargetControlType(typeof(HtmlGenericControl))]
    [ToolboxItem(false)]
    public class MembershipManagerExtender : AquariumExtenderBase
    {
        
        public MembershipManagerExtender() : 
                base("Web.MembershipManager")
        {
        }
        
        protected override bool RequiresMembershipScripts
        {
            get
            {
                return true;
            }
        }
    }
}
